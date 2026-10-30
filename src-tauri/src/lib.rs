mod compile;
mod log_parser;
mod lsp;
mod project;
mod search;
mod spell;
mod synctex;

/// `Command` para las herramientas externas (latexmk, texlab, synctex...).
/// En Windows evita que cada proceso abra una ventana de consola.
pub(crate) fn command(program: &str) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

/// En macOS las apps abiertas desde el Finder no heredan el PATH de la shell:
/// sin esto no se encuentran latexmk ni texlab (MacTeX / Homebrew).
#[cfg(target_os = "macos")]
fn extend_path() {
    let extra = ["/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin"];
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut paths: Vec<std::path::PathBuf> = std::env::split_paths(&current).collect();
    for dir in extra {
        if !paths.iter().any(|p| p == std::path::Path::new(dir)) {
            paths.push(dir.into());
        }
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var("PATH", joined);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    extend_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(compile::CompileState::default())
        .manage(lsp::LspState::default())
        .manage(spell::SpellState::default())
        .manage(project::WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            project::initial_project,
            project::list_files,
            project::detect_main,
            project::read_file,
            project::write_file,
            project::create_folder,
            project::rename_path,
            project::trash_path,
            project::save_binary,
            project::import_file,
            search::search_project,
            search::replace_in_project,
            project::read_binary,
            project::outline,
            project::import_zip,
            project::export_zip,
            project::watch_project,
            compile::compile,
            compile::cancel_compile,
            lsp::lsp_start,
            lsp::lsp_send,
            spell::spell_check,
            spell::spell_suggest,
            spell::spell_add_word,
            synctex::synctex_forward,
            synctex::synctex_inverse,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Editex");
}
