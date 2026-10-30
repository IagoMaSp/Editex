mod acp;
mod compile;
mod log_parser;
mod platform;
mod lsp;
mod project;
mod pty;
mod search;
mod spell;
mod synctex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Antes de crear hilos: las apps lanzadas desde el menú/Finder no heredan el PATH de la terminal.
    platform::augment_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(compile::CompileState::default())
        .manage(lsp::LspState::default())
        .manage(spell::SpellState::default())
        .manage(project::WatcherState::default())
        .manage(pty::PtyState::default())
        .manage(acp::AcpState::default())
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
            platform::check_tex,
            compile::compile,
            compile::cancel_compile,
            lsp::lsp_start,
            lsp::lsp_send,
            spell::spell_check,
            spell::spell_suggest,
            spell::spell_add_word,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            acp::acp_spawn,
            acp::acp_send,
            acp::acp_kill,
            synctex::synctex_forward,
            synctex::synctex_inverse,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Editex");
}
