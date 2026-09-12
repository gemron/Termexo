mod account;
mod agent;
mod cli;
mod commands;
mod config;
mod database;
mod fonts;
mod git;
mod hooks;
mod network;
mod notification;
mod process;
mod pty;
mod quota;
mod remote;
mod storage;
mod system_proxy;
mod update;
mod webview;

use std::fs;
use std::sync::Arc;

use tauri::Manager;

use crate::cli::CliOperationManager;
use crate::commands::quota::QuotaCache;
use crate::config::{CredentialStore, LaunchEnvironmentStore};
use crate::database::WorkspaceDatabase;
use crate::git::watch::RepositoryWatcher;
use crate::git::RepositoryManager;
use crate::hooks::HookEventStore;
use crate::pty::PtyManager;
use crate::remote::{RemoteAccessManager, RemoteEventHub};

pub fn capture_hook_event_from_cli() -> Result<(), String> {
    hooks::capture_hook_event_from_cli().map_err(|error| error.to_string())
}

pub fn capture_codex_notification_from_cli() -> Result<(), String> {
    hooks::capture_codex_notification_from_cli().map_err(|error| error.to_string())
}

/// Records one Antigravity status update, which is how its agent state reaches Termexo.
pub fn capture_antigravity_status_from_cli() -> Result<(), String> {
    hooks::capture_antigravity_status_from_cli().map_err(|error| error.to_string())
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

    // Nothing below can report this: without a runtime Tauri cannot build the webview, and the
    // process dies behind a panic message no user sees. An install from npm never ran an
    // installer that could deploy WebView2, so this is the only notice such a user ever gets.
    if tauri::webview_version().is_err() {
        webview::warn_runtime_missing();
        return;
    }

    // Installing the provider before anything can reach for one keeps a future dependency that
    // pulls in `ring` from making the first TLS user panic on an ambiguous default.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Windows hands out a directory on the system drive, and the database is the
            // largest thing Termexo writes, so the data can be moved elsewhere. The pointer that
            // records where stays behind in the default directory — something has to be findable
            // without configuration.
            let default_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&default_data_dir)?;
            let app_data_dir = storage::resolve_data_directory(&default_data_dir);
            fs::create_dir_all(&app_data_dir)?;
            app.manage(storage::DataDirectories {
                active: app_data_dir.clone(),
                default: default_data_dir,
            });

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

            // A status line left behind by an older or relocated Termexo fails on every agy
            // session on this machine, including ones that have nothing to do with Termexo. It is
            // repaired at startup rather than waiting for the next Antigravity terminal, which
            // may never be opened. Nothing is installed where the user has no feed.
            if let Ok(executable) = std::env::current_exe() {
                match agent::antigravity_settings::refresh(&executable) {
                    Ok(true) => tracing::info!("已更新 Antigravity 状态回传配置中的可执行文件路径"),
                    Ok(false) => {}
                    Err(error) => tracing::warn!(%error, "无法检查 Antigravity 状态回传配置"),
                }
            }

            let database = WorkspaceDatabase::open(app_data_dir.join("agentdock.db"))?;
            let hooks = HookEventStore::new(&app_data_dir)?;
            app.manage(database);
            app.manage(CredentialStore);
            app.manage(CliOperationManager::default());
            app.manage(LaunchEnvironmentStore::default());
            app.manage(hooks);

            // One hub is shared by the PTY reader threads, the command helpers and the remote
            // server, so events reach remote clients in the order their producer created them.
            let events = Arc::new(RemoteEventHub::new());
            app.manage(events.clone());
            app.manage(PtyManager::new(events.clone()));
            app.manage(RepositoryManager::default());
            app.manage(RepositoryWatcher::new(app.handle().clone(), events.clone()));
            app.manage(QuotaCache::default());

            let remote = Arc::new(RemoteAccessManager::new(app.handle().clone(), events));
            app.manage(remote.clone());
            tauri::async_runtime::spawn(async move { remote.start_if_enabled().await });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent::detect_claude,
            commands::agent::detect_codex,
            commands::agent::detect_opencode,
            commands::agent::detect_antigravity,
            commands::agent::scan_antigravity_sessions,
            commands::agent::list_antigravity_models,
            commands::agent::read_antigravity_status_feed,
            commands::agent::set_antigravity_status_feed,
            commands::agent::prepare_antigravity_launch,
            commands::agent::scan_claude_sessions,
            commands::agent::scan_codex_sessions,
            commands::agent::scan_opencode_sessions,
            commands::agent::list_agent_sessions,
            commands::agent::build_claude_launch_command,
            commands::agent::build_codex_launch_command,
            commands::agent::build_opencode_launch_command,
            commands::agent::prepare_claude_launch,
            commands::agent::inspect_claude_background_session,
            commands::agent::stop_claude_background_session,
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
            commands::git::get_repository_overview,
            commands::git::get_repository_diff,
            commands::network_export::export_network_profiles,
            commands::network_export::write_network_profile_export,
            commands::network_export::import_network_profiles,
            commands::config::list_account_profiles,
            commands::config::save_account_profile,
            commands::config::refresh_account_profile,
            commands::config::copy_account_configuration,
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
            commands::open::open_terminal_url,
            commands::open::open_terminal_path,
            commands::storage::read_storage_overview,
            commands::storage::relocate_application_data,
            commands::storage::reset_application_data_location,
            commands::terminal::get_pty_backend,
            commands::terminal::list_live_terminals,
            commands::webview::get_webview_status,
            commands::webview::open_webview_download,
            commands::terminal::create_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::terminal::read_terminal_scrollback,
            commands::remote::get_remote_access_status,
            commands::remote::update_remote_access_settings,
            commands::remote::regenerate_remote_access_token,
            commands::remote::render_remote_access_qr,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Termexo");
}
