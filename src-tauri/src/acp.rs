//! Procesos de agentes ACP (Agent Client Protocol): Claude Code, Codex, Gemini...
//! El protocolo (JSON-RPC, una línea por mensaje) lo implementa el frontend con el SDK oficial;
//! aquí solo se lanzan los procesos y se pasan las líneas por canales.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;
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

#[tauri::command]
pub async fn acp_spawn(
    state: State<'_, AcpState>,
    command: String,
    args: Vec<String>,
    cwd: String,
    on_line: Channel<String>,
    on_stderr: Channel<String>,
    on_exit: Channel<Option<i32>>,
) -> Result<u32, String> {
    let program = platform::find_program(&command).unwrap_or_else(|| command.clone().into());
    let mut child = platform::command(&program)
        .args(&args)
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

    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() && on_line.send(line).is_err() {
                break;
            }
        }
        let _ = on_exit.send(None);
    });
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if on_stderr.send(line).is_err() {
                break;
            }
        }
    });

    let id = state.next.fetch_add(1, Ordering::Relaxed);
    state.agents.lock().await.insert(id, Agent { stdin: Arc::new(Mutex::new(stdin)), child });
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
