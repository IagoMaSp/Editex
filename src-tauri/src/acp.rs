//! Procesos de agentes ACP (Agent Client Protocol): Claude Code, Codex, Gemini...
//! El protocolo (JSON-RPC, una línea por mensaje) lo implementa el frontend con el SDK oficial;
//! aquí solo se lanzan los procesos y se pasan las líneas por canales.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;

use crate::platform;

struct Agent {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Child,
}

#[derive(Default)]
pub struct AcpState {
    agents: Mutex<HashMap<u32, Agent>>,
    next: AtomicU32,
}

/// Archivo donde se guarda el stderr de los agentes, para diagnosticar fallos al conectar.
fn log_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("agentes.log"))
}

fn append_log(path: &Option<std::path::PathBuf>, line: &str) {
    use std::io::Write;
    if let Some(p) = path {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{line}");
        }
    }
}

#[tauri::command]
pub fn acp_log_path(app: AppHandle) -> Option<String> {
    log_path(&app).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn acp_spawn(
    app: AppHandle,
    state: State<'_, AcpState>,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    cwd: String,
    on_line: Channel<String>,
    on_stderr: Channel<String>,
    on_exit: Channel<Option<i32>>,
) -> Result<u32, String> {
    let log = log_path(&app);
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    append_log(&log, &format!("\n===== [{secs}] {command} {} (en {cwd})", args.join(" ")));
    let program = platform::find_program(&command).unwrap_or_else(|| command.clone().into());
    let mut child = platform::command(&program)
        .args(&args)
        .envs(env.unwrap_or_default())
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar «{command}»: {e}"))?;
    let stdout = child.stdout.take().ok_or("sin stdout")?;
    let stderr = child.stderr.take().ok_or("sin stderr")?;
    let stdin = child.stdin.take().ok_or("sin stdin")?;

    let id = state.next.fetch_add(1, Ordering::Relaxed);
    state.agents.lock().await.insert(id, Agent { stdin: Arc::new(Mutex::new(stdin)), child });

    let err_log = log.clone();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            append_log(&err_log, &line);
            let _ = on_stderr.send(line);
        }
    });
    // Cuando se cierra stdout, se espera al proceso para informar del código de salida.
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() && on_line.send(line).is_err() {
                break;
            }
        }
        let _ = stderr_task.await;
        let state = app2.state::<AcpState>();
        let child = state.agents.lock().await.remove(&id).map(|a| a.child);
        let code = match child {
            Some(mut c) => c.wait().await.ok().and_then(|s| s.code()),
            None => None,
        };
        append_log(&log, &format!("===== salió con código {code:?}"));
        let _ = on_exit.send(code);
    });
    Ok(id)
}

#[tauri::command]
pub async fn acp_send(state: State<'_, AcpState>, id: u32, line: String) -> Result<(), String> {
    let stdin = state.agents.lock().await.get(&id).map(|a| a.stdin.clone()).ok_or("agente cerrado")?;
    let mut stdin = stdin.lock().await;
    stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn acp_kill(state: State<'_, AcpState>, id: u32) -> Result<(), String> {
    if let Some(mut agent) = state.agents.lock().await.remove(&id) {
        platform::kill_tree(agent.child.id());
        let _ = agent.child.kill().await;
    }
    Ok(())
}
