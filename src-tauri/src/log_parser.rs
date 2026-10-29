//! Parser del `.log` de TeX (compilado con `-file-line-error` y `max_print_line` alto,
//! así las rutas no se cortan entre líneas).

use std::path::Path;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::project::to_rel;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Diagnostic {
    /// Ruta relativa al proyecto (o absoluta si es de fuera, p. ej. un .sty del sistema).
    pub file: Option<String>,
    pub line: Option<u32>,
    pub severity: &'static str,
    pub message: String,
}

static FILE_LINE_ERROR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(.+?\.[A-Za-z]{1,4}):(\d+): (.*)$").unwrap());
static BANG_ERROR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^! (.*)$").unwrap());
static CONTEXT_LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^l\.(\d+) ?(.*)$").unwrap());
static WARNING: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:LaTeX|Package ([\w-]+)|Class ([\w-]+)|LaTeX Font) Warning: (.*)$").unwrap()
});
static INPUT_LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"on input line (\d+)").unwrap());
static BAD_BOX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^((?:Over|Under)full \\[hv]box .*?) (?:in paragraph |detected )?at lines? (\d+)").unwrap());

pub fn parse_log(log: &str, root: &Path) -> Vec<Diagnostic> {
    let lines: Vec<&str> = log.lines().collect();
    let mut stack: Vec<Option<String>> = Vec::new();
    let mut out: Vec<Diagnostic> = Vec::new();

    let current = |stack: &[Option<String>]| stack.iter().rev().find_map(|f| f.clone());
    let normalize = |file: &str| -> String {
        let trimmed = file.trim_start_matches("./");
        let p = Path::new(trimmed);
        if p.is_absolute() {
            to_rel(root, p).unwrap_or_else(|| trimmed.to_string())
        } else {
            trimmed.to_string()
        }
    };

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];

        if let Some(c) = FILE_LINE_ERROR.captures(line) {
            let mut message = c[3].to_string();
            if let Some((_, ctx)) = find_context(&lines, i) {
                if !ctx.is_empty() {
                    message.push_str(&format!(" — {ctx}"));
                }
            }
            out.push(Diagnostic {
                file: Some(normalize(&c[1])),
                line: c[2].parse().ok(),
                severity: "error",
                message,
            });
        } else if let Some(c) = BANG_ERROR.captures(line) {
            let ctx = find_context(&lines, i);
            out.push(Diagnostic {
                file: current(&stack).map(|f| normalize(&f)),
                line: ctx.as_ref().map(|(n, _)| *n),
                severity: "error",
                message: c[1].to_string(),
            });
        } else if let Some(c) = WARNING.captures(line) {
            let mut message = c[3].to_string();
            // Las advertencias de paquetes continúan en líneas "(paquete)   ...".
            let pkg = c.get(1).or(c.get(2)).map(|m| format!("({})", m.as_str()));
            while let Some(next) = lines.get(i + 1) {
                let cont = match &pkg {
                    Some(p) if next.starts_with(p.as_str()) => next[p.len()..].trim(),
                    None if !next.is_empty() && !message.ends_with('.') => next.trim(),
                    _ => break,
                };
                message.push(' ');
                message.push_str(cont);
                i += 1;
            }
            let line_no = INPUT_LINE.captures(&message).and_then(|m| m[1].parse().ok());
            if let Some(p) = &pkg {
                message = format!("{} {message}", p);
            }
            out.push(Diagnostic {
                file: current(&stack).map(|f| normalize(&f)),
                line: line_no,
                severity: "warning",
                message,
            });
        } else if let Some(c) = BAD_BOX.captures(line) {
            out.push(Diagnostic {
                file: current(&stack).map(|f| normalize(&f)),
                line: c[2].parse().ok(),
                severity: "info",
                message: c[1].to_string(),
            });
        }

        track_files(line, &mut stack);
        i += 1;
    }

    out.dedup();
    out
}

/// Busca la línea `l.<n> <contexto>` que TeX imprime tras un error.
fn find_context(lines: &[&str], from: usize) -> Option<(u32, String)> {
    lines.iter().skip(from + 1).take(12).find_map(|l| {
        CONTEXT_LINE.captures(l).map(|c| (c[1].parse().unwrap_or(0), c[2].trim().to_string()))
    })
}

/// Sigue la pila de archivos abiertos: TeX escribe `(ruta` al abrir y `)` al cerrar.
fn track_files(line: &str, stack: &mut Vec<Option<String>>) {
    // Las líneas de error/advertencia contienen paréntesis de texto, no de archivos.
    if FILE_LINE_ERROR.is_match(line) || line.starts_with('!') {
        return;
    }
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '(' => {
                let start = i + 1;
                let mut end = start;
                while end < chars.len() && !matches!(chars[end], ' ' | '(' | ')' | '\t') {
                    end += 1;
                }
                let token: String = chars[start..end].iter().collect();
                let looks_like_file = (token.starts_with('.') || token.starts_with('/') || token.contains('/'))
                    || (token.contains('.') && token.chars().next().is_some_and(|c| c.is_alphabetic()));
                stack.push(looks_like_file.then_some(token));
                i = end;
                continue;
            }
            ')' => {
                stack.pop();
            }
            _ => {}
        }
        i += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOG: &str = r#"This is pdfTeX, Version 3.141592653-2.6-1.40.29 (TeX Live 2026/Arch Linux) (preloaded format=pdflatex)
(./main.tex
LaTeX2e <2025-11-01>
(/usr/share/texmf-dist/tex/latex/base/article.cls
Document Class: article 2024/06/29 v1.4n Standard LaTeX document class
(/usr/share/texmf-dist/tex/latex/base/size10.clo))
(./caps/uno.tex
./caps/uno.tex:7: Undefined control sequence.
l.7 Hola \foo
             mundo
LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 12.

Package hyperref Warning: Token not allowed in a PDF string (Unicode):
(hyperref)                removing `math shift' on input line 15.

Overfull \hbox (12.0pt too wide) in paragraph at lines 20--22
)
! Emergency stop.
<*> main.tex
"#;

    #[test]
    fn parses_errors_and_warnings() {
        let d = parse_log(LOG, Path::new("/proyecto"));
        assert_eq!(d[0].file.as_deref(), Some("caps/uno.tex"));
        assert_eq!(d[0].line, Some(7));
        assert_eq!(d[0].severity, "error");
        assert!(d[0].message.contains("Undefined control sequence"));
        assert!(d[0].message.contains("\\foo"));

        assert_eq!(d[1].severity, "warning");
        assert_eq!(d[1].file.as_deref(), Some("caps/uno.tex"));
        assert_eq!(d[1].line, Some(12));

        assert_eq!(d[2].line, Some(15));
        assert!(d[2].message.starts_with("(hyperref)"));
        assert!(d[2].message.contains("removing"));

        assert_eq!(d[3].severity, "info");
        assert_eq!(d[3].line, Some(20));

        assert_eq!(d[4].message, "Emergency stop.");
        assert_eq!(d[4].file.as_deref(), Some("main.tex"));
    }
}
