//! SyncTeX vía el binario `synctex`: código → PDF (forward) y PDF → código (inverse).

use std::path::Path;

use serde::Serialize;

use crate::project::to_rel;

#[derive(Serialize)]
pub struct PdfLocation {
    page: u32,
    /// Coordenadas en puntos PDF desde la esquina superior izquierda.
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Serialize)]
pub struct SourceLocation {
    file: String,
    line: u32,
}

fn field<'a>(block: &'a str, key: &str) -> Option<&'a str> {
    block.lines().find_map(|l| l.strip_prefix(key).and_then(|v| v.strip_prefix(':')))
}

async fn run(args: &[String], cwd: &Path) -> Result<String, String> {
    let out = crate::command("synctex")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("synctex: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[tauri::command]
pub async fn synctex_forward(root: String, pdf: String, file: String, line: u32) -> Result<Option<PdfLocation>, String> {
    let root = Path::new(&root);
    let input = root.join(&file);
    let out = run(&["view".into(), "-i".into(), format!("{line}:0:{}", input.display()), "-o".into(), pdf], root).await?;
    // Puede haber varios bloques; el primero basta.
    let Some(start) = out.find("Page:") else { return Ok(None) };
    let block = &out[start..];
    let num = |k: &str| field(block, k).and_then(|v| v.trim().parse::<f64>().ok());
    Ok(Some(PdfLocation {
        page: num("Page").unwrap_or(1.0) as u32,
        x: num("h").unwrap_or(0.0),
        // `v` es la línea base; restamos la altura para obtener el borde superior.
        y: num("v").unwrap_or(0.0) - num("H").unwrap_or(0.0),
        width: num("W").unwrap_or(0.0),
        height: num("H").unwrap_or(0.0),
    }))
}

#[tauri::command]
pub async fn synctex_inverse(root: String, pdf: String, page: u32, x: f64, y: f64) -> Result<Option<SourceLocation>, String> {
    let root_path = Path::new(&root);
    let out = run(&["edit".into(), "-o".into(), format!("{page}:{x:.2}:{y:.2}:{pdf}")], root_path).await?;
    let Some(input) = field(&out, "Input") else { return Ok(None) };
    let line = field(&out, "Line").and_then(|v| v.trim().parse().ok()).unwrap_or(1);
    // SyncTeX registra rutas como `/proyecto/./cap/uno.tex`.
    let cleaned = input.trim().replace("/./", "/");
    let path = Path::new(&cleaned);
    let file = if path.is_absolute() {
        to_rel(root_path, path).ok_or("archivo fuera del proyecto")?
    } else {
        cleaned.trim_start_matches("./").to_string()
    };
    Ok(Some(SourceLocation { file, line }))
}
