mod account;
mod agent;
mod cli;
mod commands;
mod config;
mod database;
mod hooks;
mod network;
mod pty;

use std::fs;

use tauri::Manager;

use crate::cli::CliOperationManager;
use crate::config::{CredentialStore, LaunchEnvironmentStore};
use crate::database::WorkspaceDatabase;
use crate::hooks::HookEventStore;
use crate::pty::PtyManager;

pub fn capture_hook_event_from_cli() -> Result<(), String> {
    hooks::capture_hook_event_from_cli().map_err(|error| error.to_string())
}

pub fn capture_codex_notification_from_cli() -> Result<(), String> {
    hooks::capture_codex_notification_from_cli().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "termexo=info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;

            let database = WorkspaceDatabase::open(app_data_dir.join("agentdock.db"))?;
            let hooks = HookEventStore::new(&app_data_dir)?;
            app.manage(database);
            app.manage(CredentialStore);
            app.manage(CliOperationManager::default());
            app.manage(LaunchEnvironmentStore::default());
            app.manage(hooks);
            app.manage(PtyManager::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent::detect_claude,
            commands::agent::detect_codex,
            commands::agent::scan_claude_sessions,
            commands::agent::scan_codex_sessions,
            commands::agent::list_agent_sessions,
            commands::agent::build_claude_launch_command,
            commands::agent::build_codex_launch_command,
            commands::agent::prepare_claude_launch,
            commands::agent::prepare_codex_launch,
            commands::agent::prepare_account_login,
            commands::cli::preview_cli_operation,
            commands::cli::execute_cli_operation,
            commands::config::list_model_profiles,
            commands::config::save_model_profile,
            commands::config::delete_model_profile,
            commands::config::list_mcp_profiles,
            commands::config::save_mcp_profile,
            commands::config::delete_mcp_profile,
            commands::config::list_network_profiles,
            commands::config::save_network_profile,
            commands::config::delete_network_profile,
            commands::config::test_network_profile,
            commands::config::list_account_profiles,
            commands::config::save_account_profile,
            commands::config::refresh_account_profile,
            commands::config::delete_account_profile,
            commands::config::validate_claude_profile,
            commands::hooks::prepare_claude_runtime,
            commands::hooks::sync_agent_events,
            commands::hooks::list_agent_events,
            commands::workspace::list_workspaces,
            commands::workspace::save_workspace,
            commands::workspace::delete_workspace,
            commands::terminal::create_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Termexo");
}
