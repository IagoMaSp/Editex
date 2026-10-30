//! Orquestador de compilación: latexmk (o el motor directo), modo rápido con
//! `\includeonly`, preámbulo precompilado y cancelación de compilaciones en curso.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Instant;

use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use tokio::sync::oneshot;

use crate::log_parser::{parse_log, Diagnostic};
use crate::platform::{self, PATH_LIST_SEP};
use crate::project::{resolve_tex_ref, strip_comment};

pub const BUILD_DIR: &str = ".editex/build";
pub const FAST_DIR: &str = ".editex/fast";
const FMT_NAME: &str = "editex-preamble";

#[derive(Default)]
pub struct CompileState {
    cancel: Mutex<Option<oneshot::Sender<()>>>,
    /// Último código pretex usado por proyecto: latexmk no detecta su cambio por sí solo.
    last_pretex: Mutex<HashMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileRequest {
    root: String,
    main: String,
    engine: String,
    fast: bool,
    active_file: Option<String>,
    shell_escape: bool,
    precompiled_preamble: bool,
    draft_images: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    status: &'static str,
    pdf: Option<String>,
    diagnostics: Vec<Diagnostic>,
    duration_ms: u64,
    /// Descripción del modo usado, p. ej. "rápido: cap2" o "completo".
    mode: String,
    output: String,
}

#[tauri::command]
pub async fn compile(state: State<'_, CompileState>, req: CompileRequest) -> Result<CompileResult, String> {
    run_compile(&state, req).await
}

pub async fn run_compile(state: &CompileState, req: CompileRequest) -> Result<CompileResult, String> {
    // Cancela la compilación anterior: solo importa la versión más reciente.
    let (tx, rx) = oneshot::channel();
    if let Some(prev) = state.cancel.lock().unwrap().replace(tx) {
        let _ = prev.send(());
    }

    let started = Instant::now();
    let root = PathBuf::from(&req.root);
    let stem = Path::new(&req.main).file_stem().unwrap_or_default().to_string_lossy().to_string();
    let engine = match req.engine.as_str() {
        "xelatex" | "lualatex" => req.engine.clone(),
        _ => "pdflatex".to_string(),
    };

    // Código que se antepone al documento (\includeonly, opciones draft).
    let mut pretex = String::new();
    let mut mode = "completo".to_string();
    let mut chapter = None;
    if req.fast {
        if let Some(active) = req.active_file.as_deref().filter(|a| *a != req.main) {
            chapter = include_ancestor(&root, &req.main, active);
        }
    }
    if let Some(ch) = &chapter {
        pretex.push_str(&format!("\\includeonly{{{ch}}}"));
        mode = format!("rápido: {ch}");
    }
    if req.draft_images {
        pretex.push_str("\\PassOptionsToPackage{draft}{graphicx}");
    }

    // El modo rápido usa su propio directorio: alternar modos no invalida la caché del otro.
    let build_rel = if chapter.is_some() { FAST_DIR } else { BUILD_DIR };
    let full_dir = root.join(BUILD_DIR);
    let outdir = root.join(build_rel);
    fs::create_dir_all(&outdir).map_err(|e| e.to_string())?;
    mirror_dirs(&root, &outdir);
    if let Some(ch) = &chapter {
        seed_fast_dir(&full_dir, &outdir, &stem, ch);
    }

    // mylatexformat necesita que el documento sea lo primero en la línea de órdenes,
    // así que el formato solo se usa sin código pretex.
    let mut fmt = None;
    let mut fmt_regenerated = false;
    if req.precompiled_preamble && engine != "lualatex" {
        if !pretex.is_empty() {
            mode.push_str(" (sin preámbulo precompilado)");
        } else {
            match ensure_format(&root, &req.main, &full_dir, &engine).await {
                Ok(regenerated) => {
                    fmt = Some(FMT_NAME);
                    fmt_regenerated = regenerated;
                    mode.push_str(" + preámbulo");
                }
                Err(e) => mode.push_str(&format!(" (sin preámbulo precompilado: {e})")),
            }
        }
    }

    let mut engine_cmd = vec![engine.clone()];
    if let Some(f) = fmt {
        engine_cmd.push(format!("-fmt={f}"));
    }
    if req.shell_escape {
        engine_cmd.push("-shell-escape".into());
    }
    // MiKTeX ignora la variable max_print_line; sin esto las rutas del log se cortan.
    if platform::tex_info().distribution == "MiKTeX" {
        engine_cmd.push("-max-print-line=100000".into());
    }

    // latexmk no detecta cambios en el código pretex ni en el formato.
    let pretex_changed = state
        .last_pretex
        .lock()
        .unwrap()
        .insert(format!("{}\0{build_rel}", req.root), format!("{pretex}\0{fmt:?}"))
        .is_some_and(|prev| prev != format!("{pretex}\0{fmt:?}"));

    let mut cmd = if let Some(latexmk) = platform::find_program("latexmk") {
        let mut c = platform::command(latexmk);
        let flag = match engine.as_str() {
            "xelatex" => "-xelatex",
            "lualatex" => "-lualatex",
            _ => "-pdf",
        };
        c.arg(flag)
            .arg(format!("-{engine}={} %O %P", engine_cmd.join(" ")))
            .arg(format!("-pretex={pretex}"))
            .args(["-synctex=1", "-interaction=nonstopmode", "-file-line-error", "-silent"])
            .arg(format!("-outdir={build_rel}"));
        if pretex_changed || fmt_regenerated {
            c.arg("-g");
        }
        c.arg(&req.main);
        c
    } else {
        // Sin latexmk: una pasada del motor (suficiente para la vista previa).
        let mut c = platform::command(&engine_cmd[0]);
        c.args(&engine_cmd[1..])
            .args(["-synctex=1", "-interaction=nonstopmode", "-file-line-error"])
            .arg(format!("-output-directory={build_rel}"))
            .arg(format!("-jobname={stem}"))
            .arg(format!("{pretex}\\input{{{}}}", req.main));
        c
    };
    cmd.current_dir(&root)
        .env("max_print_line", "100000")
        .env("error_line", "254")
        .env("half_error_line", "238")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if fmt.is_some() {
        // ':' final = añadir las rutas por defecto de kpathsea.
        cmd.env("TEXFORMATS", format!("{}{PATH_LIST_SEP}", full_dir.display()));
    }
    platform::new_process_group(&mut cmd);

    let child = cmd.spawn().map_err(|e| format!("No se pudo ejecutar {}: {e}", engine))?;
    let pid = child.id();
    let output_fut = child.wait_with_output();
    tokio::pin!(output_fut);

    let output = tokio::select! {
        out = &mut output_fut => out.map_err(|e| e.to_string())?,
        _ = rx => {
            platform::kill_tree(pid);
            return Ok(CompileResult {
                status: "cancelled",
                pdf: None,
                diagnostics: Vec::new(),
                duration_ms: started.elapsed().as_millis() as u64,
                mode,
                output: String::new(),
            });
        }
    };

    let log_text = fs::read(outdir.join(format!("{stem}.log")))
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    let diagnostics = parse_log(&log_text, &root);
    let pdf_path = outdir.join(format!("{stem}.pdf"));
    let has_errors = diagnostics.iter().any(|d| d.severity == "error");
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));

    Ok(CompileResult {
        status: if output.status.success() && !has_errors { "ok" } else { "error" },
        pdf: pdf_path.is_file().then(|| pdf_path.to_string_lossy().into_owned()),
        diagnostics,
        duration_ms: started.elapsed().as_millis() as u64,
        mode,
        output: text,
    })
}

/// Copia los auxiliares de la última compilación completa al directorio rápido, para que
/// referencias, índice y numeración de los capítulos no compilados sigan siendo correctos.
/// La primera vez copia todo; después solo los `.aux` de los otros capítulos, para no
/// invalidar el estado propio del modo rápido (latexmk compara contenidos).
fn seed_fast_dir(full_dir: &Path, fast_dir: &Path, stem: &str, chapter: &str) {
    let mtime = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).ok();
    let Some(full_time) = mtime(&full_dir.join(format!("{stem}.aux"))) else { return };
    let fast_time = mtime(&fast_dir.join(format!("{stem}.aux")));
    if fast_time.is_some_and(|t| t >= full_time) {
        return;
    }
    let first = fast_time.is_none();
    let own_aux = format!("{chapter}.aux");
    for entry in walkdir::WalkDir::new(full_dir).into_iter().flatten() {
        let path = entry.path();
        let Ok(rel) = path.strip_prefix(full_dir) else { continue };
        let rel_str = rel.to_string_lossy();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let wanted = if first {
            !matches!(ext, "pdf" | "log" | "gz" | "fdb_latexmk" | "fls" | "fmt" | "hash")
        } else {
            ext == "aux" && rel.components().count() > 1 && rel_str != own_aux
        };
        if path.is_file() && wanted {
            let _ = fs::copy(path, fast_dir.join(rel));
        }
    }
}

#[tauri::command]
pub fn cancel_compile(state: State<'_, CompileState>) {
    if let Some(tx) = state.cancel.lock().unwrap().take() {
        let _ = tx.send(());
    }
}

/// `\include{cap/x}` escribe `cap/x.aux` dentro del outdir: TeX no crea carpetas.
fn mirror_dirs(root: &Path, outdir: &Path) {
    for entry in walkdir::WalkDir::new(root)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| e.file_type().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
        .flatten()
    {
        if let Ok(rel) = entry.path().strip_prefix(root) {
            let _ = fs::create_dir_all(outdir.join(rel));
        }
    }
}

/// Nombre (tal como aparece en `\include{...}`) del capítulo que contiene `active`.
pub fn include_ancestor(root: &Path, main: &str, active: &str) -> Option<String> {
    let re = Regex::new(r"\\(input|include|subfile)\s*\{([^}]+)\}").unwrap();
    // (archivo, capítulo \include que lo contiene)
    let mut stack: Vec<(String, Option<String>)> = vec![(main.to_string(), None)];
    let mut visited = Vec::new();
    while let Some((file, chapter)) = stack.pop() {
        if visited.contains(&file) {
            continue;
        }
        visited.push(file.clone());
        let Ok(text) = fs::read_to_string(root.join(&file)) else { continue };
        for line in text.lines() {
            for cap in re.captures_iter(strip_comment(line)) {
                let Some(child) = resolve_tex_ref(root, &file, &cap[2]) else { continue };
                let child_chapter = if &cap[1] == "include" { Some(cap[2].trim().to_string()) } else { chapter.clone() };
                if child == active {
                    return child_chapter;
                }
                stack.push((child, child_chapter));
            }
        }
    }
    None
}

/// Genera (si cambió) un formato con el preámbulo ya cargado usando mylatexformat.
/// Devuelve `true` si el formato se regeneró.
async fn ensure_format(root: &Path, main: &str, outdir: &Path, engine: &str) -> Result<bool, String> {
    let text = fs::read_to_string(root.join(main)).map_err(|e| e.to_string())?;
    let end = text.find("\\begin{document}").ok_or("no hay \\begin{document}")?;
    let preamble = &text[..end];

    let mut hasher = Sha256::new();
    hasher.update(engine.as_bytes());
    hasher.update(preamble.as_bytes());
    // Los archivos que el preámbulo incluye también invalidan el formato.
    let re = Regex::new(r"\\(?:input|include|usepackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}").unwrap();
    for line in preamble.lines() {
        for cap in re.captures_iter(strip_comment(line)) {
            for name in cap[1].split(',') {
                let name = name.trim();
                for candidate in [name.to_string(), format!("{name}.tex"), format!("{name}.sty")] {
                    if let Ok(bytes) = fs::read(root.join(&candidate)) {
                        hasher.update(&bytes);
                    }
                }
            }
        }
    }
    let hash: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();

    let stamp = outdir.join(format!("{FMT_NAME}.hash"));
    if fs::read_to_string(&stamp).ok().as_deref() == Some(hash.as_str()) && outdir.join(format!("{FMT_NAME}.fmt")).is_file() {
        return Ok(false);
    }

    let out = platform::command(engine)
        .current_dir(root)
        .args(["-ini", "-interaction=nonstopmode"])
        .arg(format!("-jobname={FMT_NAME}"))
        .arg(format!("-output-directory={BUILD_DIR}"))
        .arg(format!("&{engine}"))
        .arg("mylatexformat.ltx")
        .arg(main)
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() || !outdir.join(format!("{FMT_NAME}.fmt")).is_file() {
        let _ = fs::remove_file(&stamp);
        return Err("falló la generación del formato".into());
    }
    fs::write(&stamp, hash).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_chapter_of_nested_input() {
        let dir = std::env::temp_dir().join(format!("editex-test-{}", std::process::id()));
        fs::create_dir_all(dir.join("caps")).unwrap();
        fs::write(dir.join("main.tex"), "\\include{caps/uno}\n% \\include{caps/viejo}\n\\include{caps/dos}\n").unwrap();
        fs::write(dir.join("caps/uno.tex"), "hola").unwrap();
        fs::write(dir.join("caps/dos.tex"), "\\input{caps/fig}").unwrap();
        fs::write(dir.join("caps/fig.tex"), "x").unwrap();
        assert_eq!(include_ancestor(&dir, "main.tex", "caps/uno.tex").as_deref(), Some("caps/uno"));
        assert_eq!(include_ancestor(&dir, "main.tex", "caps/fig.tex").as_deref(), Some("caps/dos"));
        assert_eq!(include_ancestor(&dir, "main.tex", "otro.tex"), None);
        fs::remove_dir_all(dir).unwrap();
    }

    /// Benchmark manual: `EDITEX_BENCH=/ruta/copia/de/examples/tesis cargo test bench -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn bench_compile_modes() {
        let root = std::env::var("EDITEX_BENCH").expect("EDITEX_BENCH");
        let _ = fs::remove_dir_all(Path::new(&root).join(".editex"));
        let state = CompileState::default();
        let req = |fast: bool, fmt: bool| -> CompileRequest {
            serde_json::from_value(serde_json::json!({
                "root": root, "main": "main.tex", "engine": "pdflatex", "fast": fast,
                "activeFile": "capitulos/conclusiones.tex", "shellEscape": false,
                "precompiledPreamble": fmt, "draftImages": false
            }))
            .unwrap()
        };
        let touch = || {
            let f = Path::new(&root).join("capitulos/conclusiones.tex");
            let mut t = fs::read_to_string(&f).unwrap();
            t.push_str("\nOtra frase.\n");
            fs::write(f, t).unwrap();
        };
        for (label, fast, fmt, edit) in [
            ("completa inicial", false, false, false),
            ("completa tras editar", false, false, true),
            ("rápida (primera)", true, false, true),
            ("rápida tras editar", true, false, true),
            ("completa tras editar", false, false, true),
            ("rápida tras editar", true, false, true),
            ("completa + preámbulo (genera)", false, true, true),
            ("completa + preámbulo", false, true, true),
        ] {
            if edit {
                touch();
            }
            let r = run_compile(&state, req(fast, fmt)).await.unwrap();
            let errors = r.diagnostics.iter().filter(|d| d.severity == "error").count();
            println!("{label:32} {:>6} ms  {:6}  errores={errors}  modo={}", r.duration_ms, r.status, r.mode);
            assert!(r.pdf.is_some());
        }
    }
}
