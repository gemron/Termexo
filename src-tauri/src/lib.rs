mod commands;
mod database;
mod pty;

use std::fs;

use tauri::Manager;

use crate::database::WorkspaceDatabase;
use crate::pty::PtyManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "agentdock=info".into()),
        )
        .init();

    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;

            let database = WorkspaceDatabase::open(app_data_dir.join("agentdock.db"))?;
            app.manage(database);
            app.manage(PtyManager::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::workspace::list_workspaces,
            commands::workspace::save_workspace,
            commands::terminal::create_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run AgentDock");
}
