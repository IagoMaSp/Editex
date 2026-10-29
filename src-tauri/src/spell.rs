//! Corrector ortográfico (Hunspell vía spellbook) con un tokenizador que entiende LaTeX:
//! ignora comandos, matemáticas, referencias, rutas y entornos de código.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use spellbook::Dictionary;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct SpellState {
    dicts: Mutex<HashMap<String, Option<Dictionary>>>,
    personal: Mutex<Option<HashSet<String>>>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Misspelling {
    /// Offsets en unidades UTF-16 (lo que usa CodeMirror).
    from: usize,
    to: usize,
    word: String,
}

/// Comandos cuyo argumento obligatorio no es texto.
const SKIP_ARG: &[&str] = &[
    "ref", "eqref", "cref", "Cref", "autoref", "pageref", "nameref", "label", "cite", "citep", "citet", "citeauthor",
    "citeyear", "parencite", "textcite", "autocite", "footcite", "nocite", "input", "include", "includeonly",
    "subfile", "includegraphics", "includepdf", "usepackage", "RequirePackage", "documentclass", "begin", "end", "url",
    "href", "bibliography", "bibliographystyle", "addbibresource", "newcommand", "renewcommand", "providecommand",
    "newenvironment", "renewenvironment", "DeclareMathOperator", "def", "setlength", "addtolength", "setcounter",
    "addtocounter", "hspace", "vspace", "color", "textcolor", "colorbox", "definecolor", "pagestyle",
    "thispagestyle", "graphicspath", "tikzset", "usetikzlibrary", "pgfplotsset", "usepgfplotslibrary", "hypersetup",
    "geometry", "lstset", "lstinputlisting", "inputminted", "mintinline", "verb", "selectlanguage", "foreignlanguage",
    "newacronym", "gls", "Gls", "glspl", "acrshort", "acrlong", "ac", "SI", "si", "num", "qty", "unit", "fontsize",
    "fontspec", "setmainfont", "setsansfont", "setmonofont", "newfontfamily", "captionsetup", "sisetup",
];

/// Cuántos argumentos `{...}` de un comando de `SKIP_ARG` no son texto.
fn non_text_args(name: &str) -> usize {
    match name {
        "newenvironment" | "renewenvironment" | "definecolor" | "newacronym" => 3,
        "newcommand" | "renewcommand" | "providecommand" | "setlength" | "addtolength" | "setcounter"
        | "addtocounter" | "DeclareMathOperator" | "SI" | "qty" | "fontsize" | "newfontfamily" => 2,
        _ => 1,
    }
}

/// Entornos cuyo contenido no es prosa.
const SKIP_ENV: &[&str] = &[
    "equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*", "multline", "multline*",
    "flalign", "flalign*", "eqnarray", "eqnarray*", "math", "displaymath", "tikzpicture", "axis", "verbatim",
    "verbatim*", "Verbatim", "lstlisting", "minted", "comment", "filecontents", "filecontents*", "pgfpicture",
    "circuitikz", "forest", "dmath", "split",
];

/// Entornos con especificación de columnas tras `\begin{...}`.
const TABULAR_ENVS: &[&str] = &["tabular", "tabular*", "tabularx", "array", "longtable", "tabu", "supertabular"];

fn dict_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/usr/share/hunspell"),
        PathBuf::from("/usr/share/myspell/dicts"),
        PathBuf::from("/usr/share/myspell"),
        PathBuf::from("/usr/local/share/hunspell"),
        PathBuf::from("/Library/Spelling"),
    ];
    if let Ok(res) = app.path().resource_dir() {
        dirs.insert(0, res.join("dictionaries"));
    }
    if let Ok(cfg) = app.path().app_config_dir() {
        dirs.insert(0, cfg.join("dictionaries"));
    }
    dirs
}

fn lang_codes(lang: &str) -> Vec<&'static str> {
    lang.split('+')
        .filter_map(|l| match l {
            "es" => Some("es_ES"),
            "en" => Some("en_US"),
            "en_GB" => Some("en_GB"),
            _ => None,
        })
        .collect()
}

fn load_dict(app: &AppHandle, code: &str) -> Option<Dictionary> {
    dict_dirs(app).iter().find_map(|dir| {
        let aff = fs::read_to_string(dir.join(format!("{code}.aff"))).ok()?;
        let dic = fs::read_to_string(dir.join(format!("{code}.dic"))).ok()?;
        Dictionary::new(&aff, &dic).ok()
    })
}

fn personal_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("words.txt"))
}

fn with_dicts<R>(app: &AppHandle, state: &SpellState, lang: &str, f: impl FnOnce(Vec<&Dictionary>, &HashSet<String>) -> R) -> R {
    let mut dicts = state.dicts.lock().unwrap();
    let codes = lang_codes(lang);
    for code in &codes {
        dicts.entry(code.to_string()).or_insert_with(|| load_dict(app, code));
    }
    let mut personal = state.personal.lock().unwrap();
    let personal = personal.get_or_insert_with(|| {
        personal_path(app)
            .and_then(|p| fs::read_to_string(p).ok())
            .map(|t| t.lines().map(str::to_string).collect())
            .unwrap_or_default()
    });
    let loaded = codes.iter().filter_map(|c| dicts.get(*c).and_then(|d| d.as_ref())).collect();
    f(loaded, personal)
}

#[tauri::command]
pub fn spell_check(app: AppHandle, state: State<SpellState>, text: String, lang: String) -> Result<Vec<Misspelling>, String> {
    with_dicts(&app, &state, &lang, |dicts, personal| {
        if dicts.is_empty() {
            return Err(format!("No se encontró diccionario para «{lang}»"));
        }
        let mut cache: HashMap<&str, bool> = HashMap::new();
        Ok(tokenize(&text)
            .into_iter()
            .filter(|(_, _, word)| {
                !*cache.entry(word).or_insert_with(|| {
                    personal.contains(*word) || dicts.iter().any(|d| d.check(word))
                })
            })
            .map(|(from, to, word)| Misspelling { from, to, word: word.to_string() })
            .collect())
    })
}

#[tauri::command]
pub fn spell_suggest(app: AppHandle, state: State<SpellState>, word: String, lang: String) -> Vec<String> {
    with_dicts(&app, &state, &lang, |dicts, _| {
        let mut all = Vec::new();
        for d in dicts {
            let mut out = Vec::new();
            d.suggest(&word, &mut out);
            all.extend(out.into_iter().take(6));
        }
        all.dedup();
        all
    })
}

#[tauri::command]
pub fn spell_add_word(app: AppHandle, state: State<SpellState>, word: String) -> Result<(), String> {
    let path = personal_path(&app).ok_or("sin directorio de configuración")?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let mut content = fs::read_to_string(&path).unwrap_or_default();
    content.push_str(&word);
    content.push('\n');
    fs::write(&path, content).map_err(|e| e.to_string())?;
    if let Some(set) = state.personal.lock().unwrap().as_mut() {
        set.insert(word);
    }
    Ok(())
}

/// Devuelve (from, to, palabra) en offsets UTF-16 para las palabras de prosa.
pub fn tokenize(text: &str) -> Vec<(usize, usize, &str)> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    // Offset UTF-16 de cada char.
    let mut u16_pos = Vec::with_capacity(chars.len() + 1);
    let mut acc = 0;
    for (_, c) in &chars {
        u16_pos.push(acc);
        acc += c.len_utf16();
    }
    u16_pos.push(acc);
    let byte_at = |i: usize| chars.get(i).map(|c| c.0).unwrap_or(text.len());
    let ch = |i: usize| chars.get(i).map(|c| c.1).unwrap_or('\0');

    let mut words = Vec::new();
    let n = chars.len();
    let mut i = 0;

    // Salta un grupo balanceado que empieza en `open` y devuelve el índice tras el cierre.
    let skip_group = |mut i: usize, open: char, close: char| -> usize {
        let mut depth = 0;
        while i < n {
            match ch(i) {
                '\\' => i += 1,
                c if c == open => depth += 1,
                c if c == close => {
                    depth -= 1;
                    if depth == 0 {
                        return i + 1;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        n
    };
    let skip_ws = |mut i: usize| {
        while i < n && (ch(i) == ' ' || ch(i) == '\t') {
            i += 1;
        }
        i
    };
    // Busca `needle` desde i (en chars) y devuelve el índice tras él.
    let find_from = |i: usize, needle: &str| -> usize {
        let start = byte_at(i);
        match text[start..].find(needle) {
            Some(off) => {
                let target = start + off + needle.len();
                chars.partition_point(|c| c.0 < target)
            }
            None => n,
        }
    };

    while i < n {
        let c = ch(i);
        match c {
            '%' => {
                while i < n && ch(i) != '\n' {
                    i += 1;
                }
            }
            '$' => {
                if ch(i + 1) == '$' {
                    i = find_from(i + 2, "$$");
                } else {
                    i += 1;
                    while i < n && ch(i) != '$' {
                        if ch(i) == '\\' {
                            i += 1;
                        }
                        i += 1;
                    }
                    i += 1;
                }
            }
            '\\' => {
                let next = ch(i + 1);
                if next == '(' {
                    i = find_from(i + 2, "\\)");
                    continue;
                }
                if next == '[' {
                    i = find_from(i + 2, "\\]");
                    continue;
                }
                let start = i + 1;
                let mut j = start;
                while j < n && ch(j).is_ascii_alphabetic() {
                    j += 1;
                }
                if j == start {
                    // Símbolo de control (\%, \&, \', ...).
                    i = start + 1;
                    continue;
                }
                let name: String = chars[start..j].iter().map(|c| c.1).collect();
                let name = name.as_str();
                if ch(j) == '*' {
                    j += 1;
                }
                if name == "begin" {
                    let k = skip_ws(j);
                    if ch(k) == '{' {
                        let end = skip_group(k, '{', '}');
                        let env: String = chars[k + 1..end.saturating_sub(1)].iter().map(|c| c.1).collect();
                        if SKIP_ENV.contains(&env.as_str()) {
                            i = find_from(end, &format!("\\end{{{env}}}"));
                            continue;
                        }
                        let mut after = end;
                        if TABULAR_ENVS.contains(&env.as_str()) {
                            loop {
                                let k = skip_ws(after);
                                match ch(k) {
                                    '{' => after = skip_group(k, '{', '}'),
                                    '[' => after = skip_group(k, '[', ']'),
                                    _ => break,
                                }
                            }
                        }
                        i = after;
                        continue;
                    }
                }
                // Argumentos opcionales casi nunca son prosa ([width=...], [spanish]...).
                let mut k = skip_ws(j);
                while ch(k) == '[' {
                    k = skip_ws(skip_group(k, '[', ']'));
                }
                if SKIP_ARG.contains(&name) {
                    if name == "verb" {
                        let delim = ch(j);
                        let mut m = j + 1;
                        while m < n && ch(m) != delim {
                            m += 1;
                        }
                        i = m + 1;
                        continue;
                    }
                    for _ in 0..non_text_args(name) {
                        if ch(k) != '{' {
                            break;
                        }
                        k = skip_ws(skip_group(k, '{', '}'));
                    }
                }
                i = k;
            }
            c if c.is_alphabetic() => {
                let start = i;
                while i < n && (ch(i).is_alphabetic() || (ch(i) == '\'' && ch(i + 1).is_alphabetic()) || ch(i) == '-' && ch(i + 1).is_alphabetic()) {
                    i += 1;
                }
                // Palabras pegadas a dígitos/underscores suelen ser identificadores.
                if ch(i).is_ascii_digit() || ch(i) == '_' || (start > 0 && (ch(start - 1).is_ascii_digit() || ch(start - 1) == '_')) {
                    continue;
                }
                let word = &text[byte_at(start)..byte_at(i)];
                // Compuestos con guion: revisar cada parte.
                let mut ps = start;
                for part in word.split('-') {
                    let len = part.chars().count();
                    if len > 1 && !part.chars().all(|c| c.is_uppercase()) {
                        words.push((u16_pos[ps], u16_pos[ps + len], part));
                    }
                    ps += len + 1;
                }
            }
            _ => i += 1,
        }
    }
    words
}

#[cfg(test)]
mod tests {
    use super::tokenize;

    fn words(t: &str) -> Vec<&str> {
        tokenize(t).into_iter().map(|w| w.2).collect()
    }

    #[test]
    fn skips_latex_constructs() {
        let t = r"\section{Introducción} Hola $x^2 + yy$ mundo \cite{knuth84} y \ref{fig:uno}. % comentario
\begin{equation} abc \end{equation} fin \includegraphics[width=0.5\textwidth]{img/foto}
\begin{tabular}{|c|l|} celda \end{tabular} \textbf{negrita} \href{http://x.y}{enlace} NASA";
        assert_eq!(
            words(t),
            vec!["Introducción", "Hola", "mundo", "fin", "celda", "negrita", "enlace"]
        );
    }

    #[test]
    fn utf16_offsets() {
        let t = "ñandú 😀 hola";
        let w = tokenize(t);
        assert_eq!(w[0], (0, 5, "ñandú"));
        // El emoji ocupa 2 unidades UTF-16.
        assert_eq!(w[1], (9, 13, "hola"));
    }

    #[test]
    fn splits_hyphenated() {
        assert_eq!(words("teórico-práctico"), vec!["teórico", "práctico"]);
    }
}
