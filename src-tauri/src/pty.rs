//! Terminal integrada: un pseudoterminal real (ConPTY en Windows) con la shell del usuario,
//! para lanzar `claude`, `codex`, etc. en la carpeta del proyecto.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::platform;

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    ptys: Mutex<HashMap<u32, Pty>>,
    next: AtomicU32,
}

/// Shell por defecto del sistema.
fn default_shell() -> CommandBuilder {
    if cfg!(windows) {
        let shell = platform::find_program("pwsh")
            .or_else(|| platform::find_program("powershell"))
            .map(|p| p.into_os_string())
            .unwrap_or_else(|| std::env::var_os("COMSPEC").unwrap_or_else(|| "cmd.exe".into()));
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-NoLogo");
        cmd
    } else {
        let fallback = if cfg!(target_os = "macos") { "/bin/zsh" } else { "/bin/bash" };
        let shell = std::env::var_os("SHELL").unwrap_or_else(|| fallback.into());
        CommandBuilder::new(shell)
    }
}

#[tauri::command]
pub fn pty_spawn(
    state: State<PtyState>,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<()>,
) -> Result<u32, String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = default_shell();
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // PATH ya incluye las rutas de TeX añadidas al arrancar (platform::augment_path).
    if let Some(path) = std::env::var_os("PATH") {
        cmd.env("PATH", path);
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("No se pudo abrir la shell: {e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Hilo bloqueante: lee la salida y la envía tal cual (xterm.js decodifica UTF-8).
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = on_exit.send(());
    });

    let id = state.next.fetch_add(1, Ordering::Relaxed);
    state.ptys.lock().unwrap().insert(id, Pty { master: pair.master, writer, child });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    let pty = ptys.get_mut(&id).ok_or("terminal cerrada")?;
    pty.writer.write_all(data.as_bytes()).and_then(|_| pty.writer.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    let pty = ptys.get(&id).ok_or("terminal cerrada")?;
    pty.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<PtyState>, id: u32) {
    if let Some(mut pty) = state.ptys.lock().unwrap().remove(&id) {
        let _ = pty.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn shell_runs_in_pty() {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        // Shell mínima: fish 4 pregunta capacidades al terminal y espera respuesta (xterm.js la da
        // en la app, aquí no hay emulador), así que se prueba la tubería del PTY con sh/cmd.
        let mut cmd = CommandBuilder::new(if cfg!(windows) { "cmd.exe" } else { "/bin/sh" });
        cmd.cwd(std::env::temp_dir());
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        // Lectura en otro hilo: `read` bloquea y el test no debe colgarse.
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        // El eco de lo tecleado no contiene "editex-ok", solo la salida real.
        let line: &[u8] = if cfg!(windows) { b"echo editex-%OS:~0,0%ok\r\n" } else { b"printf 'editex%s\\n' -ok\r" };
        writer.write_all(line).unwrap();
        let mut out = Vec::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while std::time::Instant::now() < deadline && !String::from_utf8_lossy(&out).contains("editex-ok") {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(200)) {
                out.extend(chunk);
            }
        }
        let _ = child.kill();
        assert!(String::from_utf8_lossy(&out).contains("editex-ok"), "salida: {}", String::from_utf8_lossy(&out));
    }
}
