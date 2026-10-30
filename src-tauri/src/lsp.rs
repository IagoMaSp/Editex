//! Puente entre el frontend (CodeMirror LSP client) y texlab por stdio.
//! El frontend envía JSON sin cabeceras; aquí se añade/quita el framing `Content-Length`.

use std::process::Stdio;

use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;

use crate::platform;

#[derive(Default)]
pub struct LspState {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
}

/// texlab incluido junto al ejecutable (Windows/macOS) o, si no, el del sistema.
fn texlab_path() -> Option<std::path::PathBuf> {
    let name = if cfg!(windows) { "texlab.exe" } else { "texlab" };
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(name)))
        .filter(|p| p.is_file())
        .or_else(|| platform::find_program("texlab"))
}

#[tauri::command]
pub async fn lsp_start(app: AppHandle, state: State<'_, LspState>, root: String) -> Result<(), String> {
    if let Some(mut old) = state.child.lock().await.take() {
        let _ = old.kill().await;
    }
    let mut child = platform::command(texlab_path().ok_or("No se encontró texlab")?)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("No se pudo iniciar texlab (¿está instalado?): {e}"))?;
    let stdout = child.stdout.take().ok_or("texlab sin stdout")?;
    *state.stdin.lock().await = child.stdin.take();
    *state.child.lock().await = Some(child);

    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut length = None;
            loop {
                let mut header = String::new();
                match reader.read_line(&mut header).await {
                    Ok(0) | Err(_) => {
                        let _ = app.emit("lsp-exit", ());
                        return;
                    }
                    Ok(_) => {}
                }
                let header = header.trim_end();
                if header.is_empty() {
                    break;
                }
                if let Some(v) = header.strip_prefix("Content-Length:") {
                    length = v.trim().parse::<usize>().ok();
                }
            }
            let Some(len) = length else { continue };
            let mut body = vec![0; len];
            if reader.read_exact(&mut body).await.is_err() {
                let _ = app.emit("lsp-exit", ());
                return;
            }
            let _ = app.emit("lsp-message", String::from_utf8_lossy(&body).into_owned());
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn lsp_send(state: State<'_, LspState>, message: String) -> Result<(), String> {
    let mut guard = state.stdin.lock().await;
    let stdin = guard.as_mut().ok_or("texlab no está en ejecución")?;
    let framed = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
    stdin.write_all(framed.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}
