use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast, oneshot};

/// The window `tauri.conf.json` declares without an explicit label.
const MAIN_WINDOW_LABEL: &str = "main";

/// URL the bridge claims the invoke came from.
///
/// `Webview::is_local_url` only compares scheme and domain for this first branch, and
/// `tauri_protocol_url` builds exactly this value on Windows while `useHttpsScheme` is off (which
/// this app never sets). Reading `Webview::url()` instead would block on a round trip to the main
/// thread, so the constant is deliberate — `local_invoke_url_matches_the_tauri_protocol_url`
/// locks the assumption in place.
#[cfg(windows)]
pub const LOCAL_INVOKE_URL: &str = "http://tauri.localhost/";
#[cfg(not(windows))]
pub const LOCAL_INVOKE_URL: &str = "tauri://localhost/";

/// Events a remote client is allowed to receive.
pub const EVENT_TERMINAL_OUTPUT: &str = "terminal-output";
pub const EVENT_TERMINAL_EXIT: &str = "terminal-exit";
pub const EVENT_WORKSPACE_CHANGED: &str = "workspace-changed";
pub const EVENT_WORKSPACE_DELETED: &str = "workspace-deleted";
pub const EVENT_AGENT_EVENTS: &str = "agent-events";
/// The size a terminal actually settled on after every viewer's claim was considered.
pub const EVENT_TERMINAL_RESIZED: &str = "terminal-resized";

pub const REMOTE_EVENTS: &[&str] = &[
    EVENT_TERMINAL_OUTPUT,
    EVENT_TERMINAL_EXIT,
    EVENT_WORKSPACE_CHANGED,
    EVENT_WORKSPACE_DELETED,
    EVENT_AGENT_EVENTS,
    EVENT_TERMINAL_RESIZED,
];

/// Application commands a remote client may invoke.
///
/// Tauri's ACL does not cover application commands under `Origin::Local`, and the bridge replays
/// remote requests through that very origin, so this list is the only authorization boundary a
/// remote client passes. Every command in `generate_handler!` must appear here or in
/// [`REMOTE_DENIED`]; `every_registered_command_is_classified` fails the build's test run when a
/// newly added command is left unclassified.
pub const REMOTE_ALLOWED: &[&str] = &[
    "detect_claude",
    "detect_codex",
    "detect_opencode",
    "scan_claude_sessions",
    "scan_codex_sessions",
    "scan_opencode_sessions",
    "list_agent_sessions",
    "build_claude_launch_command",
    "build_codex_launch_command",
    "build_opencode_launch_command",
    "prepare_claude_launch",
    "inspect_claude_background_session",
    "stop_claude_background_session",
    "prepare_codex_launch",
    "prepare_opencode_launch",
    "prepare_account_login",
    "list_prompt_assets",
    "save_prompt_asset",
    "delete_prompt_asset",
    "list_handoff_packages",
    "save_handoff_package",
    "delete_handoff_package",
    "collect_git_context",
    "preview_cli_operation",
    "execute_cli_operation",
    "list_model_profiles",
    "save_model_profile",
    "delete_model_profile",
    "list_mcp_profiles",
    "save_mcp_profile",
    "delete_mcp_profile",
    "list_network_profiles",
    "save_network_profile",
    "delete_network_profile",
    "test_network_profile",
    "discover_system_proxy",
    "list_account_profiles",
    "save_account_profile",
    "refresh_account_profile",
    "copy_account_configuration",
    "delete_account_profile",
    "validate_claude_profile",
    "list_system_fonts",
    "get_repository_overview",
    "get_repository_diff",
    "export_network_profiles",
    "check_for_update",
    "prepare_claude_runtime",
    "sync_agent_events",
    "list_agent_events",
    "get_provider_quotas",
    "list_workspaces",
    "save_workspace",
    "delete_workspace",
    "create_terminal",
    "write_terminal",
    "resize_terminal",
    "close_terminal",
    "read_terminal_scrollback",
    "get_remote_access_status",
    "render_remote_access_qr",
];

/// Commands a remote client must never reach, with the reason each one is held back.
pub const REMOTE_DENIED: &[&str] = &[
    // Reads and writes an arbitrary path on the host, chosen by a native file dialog.
    "write_handoff_document",
    "read_handoff_document",
    "write_network_profile_export",
    "import_network_profiles",
    // Native shell side effects that would land on the desktop, not on the remote device.
    "show_desktop_notification",
    "open_release_page",
    "update_via_npm",
    // A remote client may read the remote access state but never change it or rotate the token.
    "update_remote_access_settings",
    "regenerate_remote_access_token",
];

pub fn is_remote_command_allowed(command: &str) -> bool {
    // `plugin:*` commands are ACL-gated for real origins but not for the local one this bridge
    // claims, so they are refused wholesale rather than audited one by one. The deny list is
    // consulted first so a name that ends up in both lists stays refused.
    if command.starts_with("plugin:") || REMOTE_DENIED.contains(&command) {
        return false;
    }
    REMOTE_ALLOWED.contains(&command)
}

/// Replays a remote request through the desktop webview's own command table.
///
/// Reusing `on_message` is what keeps a single implementation of every command, its argument
/// deserialization and its validation, instead of a second dispatcher that would drift.
pub async fn dispatch(app: &AppHandle, command: String, args: Value) -> Result<Value, Value> {
    if !is_remote_command_allowed(&command) {
        return Err(Value::String("该命令不支持远程调用。".into()));
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err(Value::String("桌面窗口不可用。".into()));
    };

    let request = InvokeRequest {
        cmd: command,
        callback: CallbackFn(0),
        error: CallbackFn(0),
        url: LOCAL_INVOKE_URL
            .parse()
            .expect("the local invoke URL constant must parse"),
        body: InvokeBody::Json(args),
        headers: tauri::http::HeaderMap::new(),
        invoke_key: app.invoke_key().to_string(),
    };

    let (sender, receiver) = oneshot::channel();
    // Synchronous commands answer on the calling thread, so `on_message` must not run on a
    // runtime worker that the answer would then have to wait for.
    let dispatched = tauri::async_runtime::spawn_blocking(move || {
        window.on_message(
            request,
            Box::new(move |_webview, _command, response, _callback, _error| {
                let _ = sender.send(response);
            }),
        );
    })
    .await;
    if let Err(error) = dispatched {
        return Err(Value::String(format!("命令分发失败：{error}")));
    }

    match receiver.await {
        Ok(InvokeResponse::Ok(body)) => Ok(decode_response_body(body)),
        Ok(InvokeResponse::Err(error)) => Err(error.0),
        // `on_message` returns without answering when the invoke key does not match, which drops
        // the responder and with it the sender half.
        Err(_) => Err(Value::String("桌面窗口未响应该命令。".into())),
    }
}

fn decode_response_body(body: InvokeResponseBody) -> Value {
    match body {
        InvokeResponseBody::Json(raw) => serde_json::from_str(&raw).unwrap_or(Value::Null),
        InvokeResponseBody::Raw(bytes) => {
            Value::Array(bytes.into_iter().map(|byte| Value::from(byte)).collect())
        }
    }
}

/// A frame pushed to every connected remote client.
#[derive(Serialize)]
struct EventFrame<'a, T> {
    #[serde(rename = "type")]
    frame_type: &'static str,
    name: &'a str,
    payload: &'a T,
}

const EVENT_FRAME_TYPE: &str = "event";

/// Events are serialized once and shared, because `terminal-output` fires per PTY read.
const EVENT_CHANNEL_CAPACITY: usize = 2048;

/// Fans backend events out to the connected remote clients.
///
/// Events do not travel through `listen_any`: `Listeners::emit_filter` runs handlers on the
/// emitting thread behind a `try_lock` with a pending queue, so concurrent PTY threads would
/// reorder — or briefly strand — terminal output. Publishers call [`RemoteEventHub::publish`]
/// directly instead, inside whatever critical section already orders the data.
pub struct RemoteEventHub {
    sender: broadcast::Sender<Arc<str>>,
    connected_clients: AtomicU32,
}

impl RemoteEventHub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            sender,
            connected_clients: AtomicU32::new(0),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<str>> {
        self.sender.subscribe()
    }

    pub fn connected_clients(&self) -> u32 {
        self.connected_clients.load(Ordering::Relaxed)
    }

    /// Counts one connected client until the returned guard is dropped.
    pub fn register_client(self: &Arc<Self>) -> RemoteClientGuard {
        self.connected_clients.fetch_add(1, Ordering::Relaxed);
        RemoteClientGuard { hub: self.clone() }
    }

    pub fn publish<T: Serialize>(&self, name: &str, payload: &T) {
        if !REMOTE_EVENTS.contains(&name) {
            tracing::warn!(%name, "事件不在远程白名单内，已忽略");
            return;
        }
        // Serializing a PTY chunk for nobody is pure overhead on the reader thread.
        if self.sender.receiver_count() == 0 {
            return;
        }
        let frame = EventFrame {
            frame_type: EVENT_FRAME_TYPE,
            name,
            payload,
        };
        match serde_json::to_string(&frame) {
            Ok(encoded) => {
                let _ = self.sender.send(Arc::from(encoded.as_str()));
            }
            Err(error) => tracing::warn!(%name, %error, "无法序列化远程事件"),
        }
    }
}

impl Default for RemoteEventHub {
    fn default() -> Self {
        Self::new()
    }
}

pub struct RemoteClientGuard {
    hub: Arc<RemoteEventHub>,
}

impl Drop for RemoteClientGuard {
    fn drop(&mut self) {
        self.hub.connected_clients.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Delivers one event to the remote clients and to the desktop webview.
///
/// The remote clients come first so a slow desktop listener cannot delay the network hop.
pub fn broadcast_event<T: Serialize + Clone>(
    app: &AppHandle,
    hub: &RemoteEventHub,
    name: &str,
    payload: &T,
) {
    hub.publish(name, payload);
    if let Err(error) = app.emit(name, payload) {
        tracing::warn!(%name, %error, "无法向桌面窗口派发事件");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every command registered in `generate_handler!`, extracted from the source so a newly added
    /// command cannot silently default to either side of the boundary.
    fn registered_commands() -> Vec<String> {
        let source = include_str!("../lib.rs");
        let start = source
            .find("generate_handler![")
            .expect("lib.rs should register commands through generate_handler!");
        let body = &source[start..];
        let end = body.find(']').expect("the handler list should be closed");
        body[..end]
            .lines()
            .filter_map(|line| line.trim().strip_prefix("commands::"))
            .filter_map(|entry| entry.split("::").nth(1))
            .map(|name| name.trim_end_matches(',').to_string())
            .collect()
    }

    #[test]
    fn every_registered_command_is_classified() {
        let commands = registered_commands();
        assert!(
            commands.len() > 50,
            "the handler list should have been parsed, found {commands:?}"
        );

        for command in &commands {
            let allowed = REMOTE_ALLOWED.contains(&command.as_str());
            let denied = REMOTE_DENIED.contains(&command.as_str());
            assert!(
                allowed ^ denied,
                "{command} must appear in exactly one of REMOTE_ALLOWED / REMOTE_DENIED"
            );
            assert_eq!(is_remote_command_allowed(command), allowed);
        }
    }

    #[test]
    fn the_classification_lists_have_no_stale_entries() {
        let commands = registered_commands();

        for command in REMOTE_ALLOWED.iter().chain(REMOTE_DENIED.iter()) {
            assert!(
                commands.iter().any(|registered| registered == command),
                "{command} is classified but no longer registered"
            );
        }
    }

    #[test]
    fn plugin_commands_are_refused_even_when_named_like_an_allowed_one() {
        assert!(is_remote_command_allowed("list_workspaces"));
        assert!(!is_remote_command_allowed("plugin:dialog|open"));
        assert!(!is_remote_command_allowed("plugin:list_workspaces"));
        assert!(!is_remote_command_allowed("update_via_npm"));
        assert!(!is_remote_command_allowed("unknown_command"));
    }

    #[test]
    fn local_invoke_url_matches_the_tauri_protocol_url() {
        let url: url::Url = LOCAL_INVOKE_URL
            .parse()
            .expect("the constant should be a valid URL");

        if cfg!(windows) {
            assert_eq!(url.scheme(), "http");
            assert_eq!(url.domain(), Some("tauri.localhost"));
        } else {
            assert_eq!(url.scheme(), "tauri");
            assert_eq!(url.domain(), Some("localhost"));
        }
    }

    #[test]
    fn events_outside_the_whitelist_are_never_published() {
        let hub = Arc::new(RemoteEventHub::new());
        let mut receiver = hub.subscribe();

        hub.publish(
            "secret-internal-event",
            &serde_json::json!({ "leak": true }),
        );
        hub.publish(EVENT_TERMINAL_EXIT, &serde_json::json!({ "ok": true }));

        let frame = receiver.try_recv().expect("the event should be published");
        assert!(frame.contains("\"type\":\"event\""));
        assert!(frame.contains(EVENT_TERMINAL_EXIT));
        assert!(!frame.contains("secret-internal-event"));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn connected_clients_follow_the_registration_guard() {
        let hub = Arc::new(RemoteEventHub::new());
        assert_eq!(hub.connected_clients(), 0);

        let first = hub.register_client();
        let second = hub.register_client();
        assert_eq!(hub.connected_clients(), 2);

        drop(second);
        assert_eq!(hub.connected_clients(), 1);
        drop(first);
        assert_eq!(hub.connected_clients(), 0);
    }

    #[test]
    fn raw_response_bodies_become_byte_arrays() {
        assert_eq!(
            decode_response_body(InvokeResponseBody::Raw(vec![1, 2, 3])),
            serde_json::json!([1, 2, 3])
        );
        assert_eq!(
            decode_response_body(InvokeResponseBody::Json("{\"a\":1}".into())),
            serde_json::json!({ "a": 1 })
        );
        assert_eq!(
            decode_response_body(InvokeResponseBody::Json(String::new())),
            Value::Null
        );
    }
}
