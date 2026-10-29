//! Proyecto: árbol de archivos, lectura/escritura, outline, ZIP y watcher.

use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Directorios que nunca se muestran ni se exportan.
const IGNORED_DIRS: &[&str] = &[".git", ".editex", "node_modules", ".svn"];

#[derive(Default)]
pub struct WatcherState(pub Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>);

#[derive(Serialize)]
pub struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<FileNode>,
}

#[derive(Serialize)]
pub struct OutlineItem {
    level: u8,
    title: String,
    file: String,
    line: u32,
}

/// Une `rel` a `root` rechazando rutas absolutas o que escapen del proyecto.
pub fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() || rel_path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("Ruta fuera del proyecto: {rel}"));
    }
    Ok(Path::new(root).join(rel_path))
}

/// Ruta relativa con separadores '/' (lo que usa el frontend).
pub fn to_rel(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    Some(rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
}

fn build_tree(root: &Path, dir: &Path) -> Vec<FileNode> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut nodes: Vec<FileNode> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let path = e.path();
            let is_dir = path.is_dir();
            if is_dir && (IGNORED_DIRS.contains(&name.as_str()) || name.starts_with('.')) {
                return None;
            }
            Some(FileNode {
                children: if is_dir { build_tree(root, &path) } else { Vec::new() },
                path: to_rel(root, &path)?,
                name,
                is_dir,
            })
        })
        .collect();
    nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    nodes
}

/// Carpeta pasada como argumento (`editex ./mi-tesis`), si existe.
#[tauri::command]
pub fn initial_project() -> Option<String> {
    let arg = std::env::args().skip(1).find(|a| !a.starts_with('-'))?;
    let path = fs::canonicalize(arg).ok()?;
    path.is_dir().then(|| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_files(root: String) -> Result<Vec<FileNode>, String> {
    let root = Path::new(&root);
    if !root.is_dir() {
        return Err(format!("No existe la carpeta {}", root.display()));
    }
    Ok(build_tree(root, root))
}

/// Archivo principal: `main.tex` si existe, si no el primer .tex con `\documentclass`.
#[tauri::command]
pub fn detect_main(root: String) -> Option<String> {
    let root_path = Path::new(&root);
    if root_path.join("main.tex").is_file() {
        return Some("main.tex".into());
    }
    let mut candidates: Vec<PathBuf> = walkdir::WalkDir::new(root_path)
        .max_depth(3)
        .into_iter()
        .filter_entry(|e| !IGNORED_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
        .flatten()
        .map(|e| e.into_path())
        .filter(|p| p.extension().is_some_and(|e| e == "tex"))
        .collect();
    // Preferir los archivos menos profundos.
    candidates.sort_by_key(|p| p.components().count());
    candidates.into_iter().find_map(|p| {
        let text = fs::read_to_string(&p).ok()?;
        text.lines()
            .any(|l| strip_comment(l).trim_start().starts_with("\\documentclass"))
            .then(|| to_rel(root_path, &p))
            .flatten()
    })
}

#[tauri::command]
pub fn read_file(root: String, path: String) -> Result<String, String> {
    let full = resolve(&root, &path)?;
    let bytes = fs::read(&full).map_err(|e| format!("{}: {e}", full.display()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub fn write_file(root: String, path: String, content: String) -> Result<(), String> {
    let full = resolve(&root, &path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Escritura atómica: evita PDFs/compilaciones leyendo un archivo a medias.
    let tmp = full.with_extension("editex-tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &full).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(root: String, path: String) -> Result<(), String> {
    fs::create_dir_all(resolve(&root, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_path(root: String, from: String, to: String) -> Result<(), String> {
    let (src, dst) = (resolve(&root, &from)?, resolve(&root, &to)?);
    if dst.exists() {
        return Err(format!("Ya existe {to}"));
    }
    if dst.starts_with(&src) {
        return Err("No se puede mover una carpeta dentro de sí misma".into());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(src, dst).map_err(|e| e.to_string())
}

/// Mueve a la papelera del sistema (recuperable), nunca borra definitivamente.
#[tauri::command]
pub fn trash_path(root: String, path: String) -> Result<(), String> {
    let full = resolve(&root, &path)?;
    if path.is_empty() || full == Path::new(&root) {
        return Err("No se puede borrar la raíz del proyecto".into());
    }
    trash::delete(&full).map_err(|e| format!("No se pudo mover a la papelera: {e}"))
}

/// Ruta libre `dir/stem.ext`, añadiendo `-2`, `-3`... si ya existe.
fn unique_rel(root: &str, dir: &str, stem: &str, ext: &str) -> Result<String, String> {
    for i in 1..1000 {
        let name = if i == 1 { format!("{stem}.{ext}") } else { format!("{stem}-{i}.{ext}") };
        let rel = if dir.is_empty() { name } else { format!("{dir}/{name}") };
        if !resolve(root, &rel)?.exists() {
            return Ok(rel);
        }
    }
    Err("demasiados archivos con el mismo nombre".into())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Guarda bytes (p. ej. una imagen pegada) en `dir/stem.ext` sin sobrescribir.
/// Los datos llegan como cuerpo binario; root/dir/stem/ext en cabeceras URL-encoded.
#[tauri::command]
pub fn save_binary(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("se esperaban datos binarios".into());
    };
    let header = |k: &str| -> Result<String, String> {
        let v = request.headers().get(k).ok_or(format!("falta {k}"))?;
        Ok(percent_decode(v.to_str().map_err(|e| e.to_string())?))
    };
    let (root, dir) = (header("x-root")?, header("x-dir")?);
    let rel = unique_rel(&root, &dir, &header("x-stem")?, &header("x-ext")?)?;
    let full = resolve(&root, &rel)?;
    fs::create_dir_all(full.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(full, data).map_err(|e| e.to_string())?;
    Ok(rel)
}

/// Copia un archivo externo (arrastrado desde el gestor de archivos) dentro del proyecto.
#[tauri::command]
pub fn import_file(root: String, source: String, dir: String) -> Result<String, String> {
    let src = Path::new(&source);
    let stem = src.file_stem().ok_or("ruta sin nombre")?.to_string_lossy();
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let rel = unique_rel(&root, &dir, &stem, &ext)?;
    let full = resolve(&root, &rel)?;
    fs::create_dir_all(full.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::copy(src, full).map_err(|e| e.to_string())?;
    Ok(rel)
}

#[tauri::command]
pub fn read_binary(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| format!("{path}: {e}"))
}

/// Quita un comentario `%` no escapado.
pub fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'%' {
            let backslashes = bytes[..i].iter().rev().take_while(|&&c| c == b'\\').count();
            if backslashes % 2 == 0 {
                return &line[..i];
            }
        }
    }
    line
}

/// Resuelve el argumento de `\input{x}` / `\include{x}` a una ruta relativa existente.
pub fn resolve_tex_ref(root: &Path, from_file: &str, arg: &str) -> Option<String> {
    let arg = arg.trim();
    let with_ext = if arg.ends_with(".tex") { arg.to_string() } else { format!("{arg}.tex") };
    // LaTeX resuelve relativo al directorio de compilación (raíz); probamos también el del archivo.
    let from_dir = Path::new(from_file).parent().unwrap_or(Path::new(""));
    [PathBuf::from(&with_ext), from_dir.join(&with_ext)]
        .into_iter()
        .find(|p| root.join(p).is_file())
        .and_then(|p| to_rel(root, &root.join(p)))
}

#[tauri::command]
pub fn outline(root: String, main: String) -> Vec<OutlineItem> {
    let section_re = Regex::new(
        r"\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{",
    )
    .unwrap();
    let input_re = Regex::new(r"\\(?:input|include|subfile)\s*\{([^}]+)\}").unwrap();
    let mut items = Vec::new();
    let mut visited = Vec::new();
    collect_outline(Path::new(&root), &main, &section_re, &input_re, &mut items, &mut visited);
    items
}

fn collect_outline(
    root: &Path,
    file: &str,
    section_re: &Regex,
    input_re: &Regex,
    items: &mut Vec<OutlineItem>,
    visited: &mut Vec<String>,
) {
    if visited.iter().any(|v| v == file) || visited.len() > 500 {
        return;
    }
    visited.push(file.to_string());
    let Ok(text) = fs::read_to_string(root.join(file)) else { return };
    for (n, raw) in text.lines().enumerate() {
        let line = strip_comment(raw);
        for cap in section_re.captures_iter(line) {
            let level = match &cap[1] {
                "part" => 0,
                "chapter" => 1,
                "section" => 2,
                "subsection" => 3,
                "subsubsection" => 4,
                _ => 5,
            };
            let start = cap.get(0).unwrap().end();
            items.push(OutlineItem { level, title: balanced_arg(&line[start..]), file: file.into(), line: n as u32 + 1 });
        }
        for cap in input_re.captures_iter(line) {
            if let Some(child) = resolve_tex_ref(root, file, &cap[1]) {
                collect_outline(root, &child, section_re, input_re, items, visited);
            }
        }
    }
}

/// Texto hasta la llave de cierre que equilibra (el `{` inicial ya fue consumido).
fn balanced_arg(s: &str) -> String {
    let mut depth = 1;
    for (i, c) in s.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return s[..i].trim().to_string();
                }
            }
            _ => {}
        }
    }
    s.trim().to_string()
}

#[tauri::command]
pub fn import_zip(zip_path: String, dest: String) -> Result<String, String> {
    let file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    // `extract` descarta entradas con rutas que escapan del destino.
    archive.extract(&dest).map_err(|e| e.to_string())?;
    // Si el ZIP contiene una única carpeta raíz, el proyecto es esa carpeta.
    let entries: Vec<_> = fs::read_dir(&dest).map_err(|e| e.to_string())?.flatten().collect();
    if entries.len() == 1 && entries[0].path().is_dir() {
        return Ok(entries[0].path().to_string_lossy().into_owned());
    }
    Ok(dest)
}

#[tauri::command]
pub fn export_zip(root: String, zip_path: String) -> Result<(), String> {
    let root_path = Path::new(&root);
    let out = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(out);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for entry in walkdir::WalkDir::new(root_path)
        .into_iter()
        .filter_entry(|e| !IGNORED_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() || path == Path::new(&zip_path) {
            continue;
        }
        let Some(rel) = to_rel(root_path, path) else { continue };
        zip.start_file(rel, options).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        fs::File::open(path).and_then(|mut f| f.read_to_end(&mut buf)).map_err(|e| e.to_string())?;
        zip.write_all(&buf).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Observa el proyecto y emite `fs-changed` con las rutas relativas modificadas.
#[tauri::command]
pub fn watch_project(app: AppHandle, state: State<WatcherState>, root: String) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    let watch_root = root_path.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(300), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let changed: Vec<String> = events
            .iter()
            .filter_map(|e| to_rel(&watch_root, &e.path))
            .filter(|rel| {
                !rel.split('/').any(|part| IGNORED_DIRS.contains(&part)) && !rel.ends_with(".editex-tmp")
            })
            .collect();
        if !changed.is_empty() {
            let _ = app.emit("fs-changed", changed);
        }
    })
    .map_err(|e| e.to_string())?;
    debouncer.watcher().watch(&root_path, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_unescaped_comments() {
        assert_eq!(strip_comment(r"texto % comentario"), "texto ");
        assert_eq!(strip_comment(r"50\% de algo"), r"50\% de algo");
        assert_eq!(strip_comment(r"a\\% b"), r"a\\");
    }

    #[test]
    fn balanced_argument() {
        assert_eq!(balanced_arg("Intro {\\em a} b} resto"), "Intro {\\em a} b");
    }

    #[test]
    fn decodes_percent() {
        assert_eq!(percent_decode("/home/iago/F%C3%ADsica%20x"), "/home/iago/Física x");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn rejects_escaping_paths() {
        assert!(resolve("/tmp/p", "../x").is_err());
        assert!(resolve("/tmp/p", "/etc/passwd").is_err());
        assert!(resolve("/tmp/p", "cap/1.tex").is_ok());
    }
}
