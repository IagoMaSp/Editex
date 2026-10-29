//! Buscar y reemplazar en todos los archivos de texto del proyecto.

use std::fs;
use std::path::Path;

use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use crate::project::{resolve, to_rel};

/// Extensiones que se consideran texto editable.
const TEXT_EXT: &[&str] = &["tex", "bib", "sty", "cls", "txt", "md", "cfg", "def", "ltx", "dtx", "bbx", "cbx", "tikz", "csv"];
const MAX_MATCHES: usize = 5000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    query: String,
    regex: bool,
    case_sensitive: bool,
    whole_word: bool,
}

#[derive(Serialize, Debug)]
pub struct Match {
    line: u32,
    /// Columnas en unidades UTF-16 dentro de la línea (las de CodeMirror).
    from: u32,
    to: u32,
    text: String,
}

#[derive(Serialize, Debug)]
pub struct FileMatches {
    file: String,
    matches: Vec<Match>,
}

fn build_regex(opts: &SearchOptions) -> Result<Regex, String> {
    let mut pattern = if opts.regex { opts.query.clone() } else { regex::escape(&opts.query) };
    if opts.whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .multi_line(true)
        .build()
        .map_err(|e| format!("Expresión no válida: {e}"))
}

fn text_files(root: &Path) -> impl Iterator<Item = std::path::PathBuf> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.'))
        .flatten()
        .map(|e| e.into_path())
        .filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| TEXT_EXT.contains(&e)))
}

fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

fn search_text(re: &Regex, text: &str) -> Vec<Match> {
    let mut out = Vec::new();
    for (n, line) in text.lines().enumerate() {
        for m in re.find_iter(line) {
            if m.start() == m.end() {
                continue;
            }
            out.push(Match {
                line: n as u32 + 1,
                from: utf16_len(&line[..m.start()]),
                to: utf16_len(&line[..m.end()]),
                text: line.trim_end().chars().take(300).collect(),
            });
        }
    }
    out
}

#[tauri::command]
pub fn search_project(root: String, opts: SearchOptions) -> Result<Vec<FileMatches>, String> {
    if opts.query.is_empty() {
        return Ok(Vec::new());
    }
    let re = build_regex(&opts)?;
    let root_path = Path::new(&root);
    let mut results = Vec::new();
    let mut total = 0;
    for path in text_files(root_path) {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let matches = search_text(&re, &text);
        if matches.is_empty() {
            continue;
        }
        total += matches.len();
        if let Some(file) = to_rel(root_path, &path) {
            results.push(FileMatches { file, matches });
        }
        if total >= MAX_MATCHES {
            break;
        }
    }
    results.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(results)
}

/// Reemplaza en los archivos indicados y devuelve cuántas sustituciones hizo.
/// Con `regex`, el reemplazo admite `$1`, `${nombre}`.
#[tauri::command]
pub fn replace_in_project(root: String, opts: SearchOptions, replacement: String, files: Vec<String>) -> Result<usize, String> {
    let re = build_regex(&opts)?;
    let mut count = 0;
    for file in files {
        let path = resolve(&root, &file)?;
        let text = fs::read_to_string(&path).map_err(|e| format!("{file}: {e}"))?;
        // Por líneas, igual que la búsqueda, para que `^`/`$` y los resultados coincidan.
        let n = text.lines().map(|l| re.find_iter(l).filter(|m| m.start() != m.end()).count()).sum::<usize>();
        if n == 0 {
            continue;
        }
        let new_text: String = text
            .split_inclusive('\n')
            .map(|chunk| {
                let (line, nl) = match chunk.strip_suffix("\r\n") {
                    Some(l) => (l, "\r\n"),
                    None => match chunk.strip_suffix('\n') {
                        Some(l) => (l, "\n"),
                        None => (chunk, ""),
                    },
                };
                let replaced = if opts.regex {
                    re.replace_all(line, replacement.as_str())
                } else {
                    re.replace_all(line, NoExpand(&replacement))
                };
                format!("{replaced}{nl}")
            })
            .collect();
        fs::write(&path, new_text).map_err(|e| format!("{file}: {e}"))?;
        count += n;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(q: &str, regex: bool, case: bool, word: bool) -> SearchOptions {
        SearchOptions { query: q.into(), regex, case_sensitive: case, whole_word: word }
    }

    #[test]
    fn finds_with_utf16_columns() {
        let re = build_regex(&opts("energía", false, false, false)).unwrap();
        let m = search_text(&re, "La ñ y la Energía\notra energía");
        assert_eq!(m.len(), 2);
        assert_eq!((m[0].line, m[0].from, m[0].to), (1, 10, 17));
        assert_eq!(m[1].line, 2);
    }

    #[test]
    fn whole_word_and_literal() {
        let re = build_regex(&opts("a.b", false, true, true)).unwrap();
        assert_eq!(search_text(&re, "a.b axb a.bc").len(), 1);
    }

    #[test]
    fn replaces_preserving_newlines() {
        let dir = std::env::temp_dir().join(format!("editex-search-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.tex"), "uno dos\r\nuno\n").unwrap();
        let n = replace_in_project(dir.to_string_lossy().into(), opts("(uno)", true, true, false), "[$1]".into(), vec!["a.tex".into()]).unwrap();
        assert_eq!(n, 2);
        assert_eq!(fs::read_to_string(dir.join("a.tex")).unwrap(), "[uno] dos\r\n[uno]\n");
        fs::remove_dir_all(dir).unwrap();
    }
}
