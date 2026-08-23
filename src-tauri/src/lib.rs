mod account;
mod agent;
mod cli;
mod commands;
mod config;
mod database;
mod fonts;
mod hooks;
mod network;
mod notification;
mod pty;
mod quota;
mod system_proxy;
mod update;

use std::fs;

use tauri::Manager;

use crate::cli::CliOperationManager;
use crate::commands::quota::QuotaCache;
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

pub fn capture_codex_hook_event_from_cli() -> Result<(), String> {
    hooks::capture_codex_hook_event_from_cli().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The library compiles as `termexo_lib`, so a `termexo=info` filter alone would drop every
    // event this crate emits — including the proxy diagnostics.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "termexo=info,termexo_lib=info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;

            // Without a registered AppUserModelID Windows silently drops every toast, which is
            // what happens when Termexo runs from the npm package instead of an installer.
            // `icons/` is not bundled as a resource, so a missing file just means the toast
            // falls back to the default shell icon.
            let icon = app
                .path()
                .resolve("icons/128x128.png", tauri::path::BaseDirectory::Resource)
                .ok()
                .filter(|path| path.exists());
            if let Err(error) = notification::register_toast_identity(app.config(), icon.as_deref())
            {
                tracing::warn!("{error}");
            }

            let database = WorkspaceDatabase::open(app_data_dir.join("agentdock.db"))?;
            let hooks = HookEventStore::new(&app_data_dir)?;
            app.manage(database);
            app.manage(CredentialStore);
            app.manage(CliOperationManager::default());
            app.manage(LaunchEnvironmentStore::default());
            app.manage(hooks);
            app.manage(PtyManager::default());
            app.manage(QuotaCache::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent::detect_claude,
            commands::agent::detect_codex,
            commands::agent::detect_opencode,
            commands::agent::scan_claude_sessions,
            commands::agent::scan_codex_sessions,
            commands::agent::scan_opencode_sessions,
            commands::agent::list_agent_sessions,
            commands::agent::build_claude_launch_command,
            commands::agent::build_codex_launch_command,
            commands::agent::build_opencode_launch_command,
            commands::agent::prepare_claude_launch,
            commands::agent::prepare_codex_launch,
            commands::agent::prepare_opencode_launch,
            commands::agent::prepare_account_login,
            commands::assets::list_prompt_assets,
            commands::assets::save_prompt_asset,
            commands::assets::delete_prompt_asset,
            commands::assets::list_handoff_packages,
            commands::assets::save_handoff_package,
            commands::assets::delete_handoff_package,
            commands::assets::collect_git_context,
            commands::assets::write_handoff_document,
            commands::assets::read_handoff_document,
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
            commands::config::discover_system_proxy,
            commands::fonts::list_system_fonts,
            commands::network_export::export_network_profiles,
            commands::network_export::write_network_profile_export,
            commands::network_export::import_network_profiles,
            commands::config::list_account_profiles,
            commands::config::save_account_profile,
            commands::config::refresh_account_profile,
            commands::config::delete_account_profile,
            commands::config::validate_claude_profile,
            commands::notification::show_desktop_notification,
            commands::update::check_for_update,
            commands::update::open_release_page,
            commands::update::update_via_npm,
            commands::hooks::prepare_claude_runtime,
            commands::hooks::sync_agent_events,
            commands::hooks::list_agent_events,
            commands::quota::get_provider_quotas,
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
