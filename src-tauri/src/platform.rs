//! Diferencias entre Linux, macOS y Windows: PATH, búsqueda de programas, procesos y rutas.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;

/// Directorios donde suelen estar las distribuciones TeX y herramientas.
/// Las apps lanzadas desde el Finder (macOS) o el menú no heredan el PATH de la terminal.
fn extra_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    if cfg!(target_os = "macos") {
        for d in ["/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin"] {
            dirs.push(PathBuf::from(d));
        }
    } else if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join(r"Programs\MiKTeX\miktex\bin\x64"));
        }
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(pf) = std::env::var_os(var) {
                dirs.push(PathBuf::from(pf).join(r"MiKTeX\miktex\bin\x64"));
            }
        }
        // TeX Live: C:\texlive\<año>\bin\windows (o win32/win64 en versiones antiguas); el año más reciente primero.
        if let Ok(entries) = std::fs::read_dir(r"C:\texlive") {
            let mut years: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
            years.sort();
            for year in years.into_iter().rev() {
                for sub in ["windows", "win64", "win32"] {
                    dirs.push(year.join("bin").join(sub));
                }
            }
        }
    } else if let Some(h) = &home {
        dirs.push(h.join(".local/bin"));
    }
    // Instalación oficial de TeX Live en Unix: /usr/local/texlive/<año>/bin/<arquitectura>.
    if cfg!(unix) {
        if let Ok(years) = std::fs::read_dir("/usr/local/texlive") {
            let mut years: Vec<PathBuf> = years.flatten().map(|e| e.path().join("bin")).collect();
            years.sort();
            for bin in years.into_iter().rev() {
                if let Ok(archs) = std::fs::read_dir(bin) {
                    dirs.extend(archs.flatten().map(|e| e.path()));
                }
            }
        }
    }
    if let Some(h) = home {
        dirs.push(h.join(".cargo").join("bin"));
    }
    dirs.into_iter().filter(|d| d.is_dir()).collect()
}

/// Añade al PATH del proceso los directorios conocidos. Se llama una vez al arrancar,
/// antes de crear hilos.
pub fn augment_path() {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut paths: Vec<PathBuf> = std::env::split_paths(&current).collect();
    for d in extra_dirs() {
        if !paths.contains(&d) {
            paths.push(d);
        }
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var("PATH", joined);
    }
}

/// Busca un ejecutable en el PATH (con las extensiones de PATHEXT en Windows).
pub fn find_program(name: &str) -> Option<PathBuf> {
    let exts: Vec<OsString> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".EXE;.CMD;.BAT".into())
            .split(';')
            .map(|e| OsString::from(e.to_lowercase()))
            .chain(std::iter::once(OsString::new()))
            .collect()
    } else {
        vec![OsString::new()]
    };
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| {
        exts.iter().find_map(|ext| {
            let mut file = OsString::from(name);
            file.push(ext);
            let candidate = dir.join(file);
            candidate.is_file().then_some(candidate)
        })
    })
}

/// `tokio::process::Command` que en Windows no abre una ventana de consola por cada proceso.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Igual que [`command`] pero síncrono (std).
pub fn std_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// Prepara el comando para poder matar después todo su árbol de procesos.
pub fn new_process_group(cmd: &mut tokio::process::Command) {
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(not(unix))]
    let _ = cmd;
}

/// Mata un proceso y sus hijos (latexmk lanza pdflatex, biber...).
pub fn kill_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGTERM);
    }
    #[cfg(windows)]
    {
        let _ = std_command("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
}

/// Separador de listas de rutas en variables como TEXFORMATS.
pub const PATH_LIST_SEP: &str = if cfg!(windows) { ";" } else { ":" };

/// Ruta con `/` como separador (TeX y SyncTeX las prefieren así también en Windows).
pub fn slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Convierte una ruta tal como la escribe TeX/SyncTeX (absoluta o relativa, con `./`,
/// `\` o `/`) en una ruta relativa al proyecto con `/`.
pub fn rel_from_reported(root: &Path, reported: &str) -> Option<String> {
    let clean = |s: &str| -> String {
        let s = s.trim().replace('\\', "/");
        let mut parts: Vec<&str> = Vec::new();
        for part in s.split('/') {
            match part {
                "." => {}
                ".." => {
                    parts.pop();
                }
                p => parts.push(p),
            }
        }
        parts.join("/")
    };
    let reported = clean(reported);
    let root = clean(&root.to_string_lossy());
    let is_abs = reported.starts_with('/') || reported.as_bytes().get(1) == Some(&b':');
    if !is_abs {
        return Some(reported.trim_start_matches('/').to_string());
    }
    // En Windows y macOS el sistema de archivos no distingue mayúsculas.
    let (r, p) = if cfg!(any(windows, target_os = "macos")) {
        (root.to_lowercase(), reported.to_lowercase())
    } else {
        (root.clone(), reported.clone())
    };
    let prefix = format!("{}/", r.trim_end_matches('/'));
    p.starts_with(&prefix).then(|| reported[prefix.len()..].to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TexInfo {
    pub os: &'static str,
    /// "TeX Live", "MiKTeX" o "" si no se encontró ninguna.
    pub distribution: String,
    pub pdflatex: bool,
    pub xelatex: bool,
    pub lualatex: bool,
    pub latexmk: bool,
    pub biber: bool,
    pub synctex: bool,
}

fn detect() -> TexInfo {
    let version = std_command(find_program("pdflatex").unwrap_or_else(|| "pdflatex".into()))
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let distribution = if version.contains("MiKTeX") {
        "MiKTeX"
    } else if version.contains("TeX Live") {
        "TeX Live"
    } else if !version.is_empty() {
        "TeX"
    } else {
        ""
    };
    TexInfo {
        os: if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "macos" } else { "linux" },
        distribution: distribution.into(),
        pdflatex: find_program("pdflatex").is_some(),
        xelatex: find_program("xelatex").is_some(),
        lualatex: find_program("lualatex").is_some(),
        latexmk: find_program("latexmk").is_some(),
        biber: find_program("biber").is_some(),
        synctex: find_program("synctex").is_some(),
    }
}

static TEX: OnceLock<TexInfo> = OnceLock::new();

pub fn tex_info() -> &'static TexInfo {
    TEX.get_or_init(detect)
}

/// Qué hay instalado, para avisar en la interfaz si falta la distribución TeX.
#[tauri::command]
pub async fn check_tex() -> TexInfo {
    tauri::async_runtime::spawn_blocking(|| tex_info().clone()).await.unwrap_or_else(|_| detect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_from_reported_paths() {
        let root = Path::new("/home/u/tesis");
        assert_eq!(rel_from_reported(root, "/home/u/tesis/./capitulos/uno.tex").as_deref(), Some("capitulos/uno.tex"));
        assert_eq!(rel_from_reported(root, "./main.tex").as_deref(), Some("main.tex"));
        assert_eq!(rel_from_reported(root, "/usr/share/texmf/x.sty"), None);
        assert_eq!(rel_from_reported(Path::new(r"C:\Users\u\tesis"), r"C:/Users/u/tesis/./cap/a.tex").as_deref(), Some("cap/a.tex"));
    }

    #[test]
    fn finds_programs_in_path() {
        assert!(find_program(if cfg!(windows) { "cmd" } else { "sh" }).is_some());
        assert!(find_program("no-existe-este-programa").is_none());
    }
}
