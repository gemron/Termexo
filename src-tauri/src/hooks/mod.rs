use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HookError {
    #[error("hook event access failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("hook event is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("hook event cursor lock is poisoned")]
    LockPoisoned,
    #[error("hook command arguments are incomplete")]
    InvalidArguments,
    #[error("Codex notification command contains an unsupported TOML delimiter")]
    InvalidNotifyValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub event_key: String,
    pub agent_type: String,
    pub native_session_id: Option<String>,
    pub terminal_id: String,
    pub event_type: String,
    pub detail: Value,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRuntimeSettings {
    pub settings_path: String,
    pub event_file: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredHookEvent {
    event_key: String,
    #[serde(default)]
    agent_type: Option<String>,
    terminal_id: String,
    received_at: i64,
    payload: Value,
}

pub struct HookEventStore {
    event_file: PathBuf,
    runtime_directory: PathBuf,
    cursor: Mutex<u64>,
}

impl HookEventStore {
    pub fn new(app_data_directory: &Path) -> Result<Self, HookError> {
        let runtime_directory = app_data_directory.join("runtime");
        fs::create_dir_all(&runtime_directory)?;
        Ok(Self {
            event_file: app_data_directory.join("claude-hook-events.jsonl"),
            runtime_directory,
            cursor: Mutex::new(0),
        })
    }

    pub fn prepare_claude_runtime(
        &self,
        terminal_id: &str,
    ) -> Result<ClaudeRuntimeSettings, HookError> {
        let executable = std::env::current_exe()?;
        let command = format!(
            "{} hook-event --event-file {} --terminal-id {}",
            command_quote(&executable.to_string_lossy()),
            command_quote(&self.event_file.to_string_lossy()),
            command_quote(terminal_id),
        );
        let hook = || {
            json!({
                "matcher": "",
                "hooks": [{
                    "type": "command",
                    "command": command,
                    "timeout": 10
                }]
            })
        };
        let settings = json!({
            "hooks": {
                "SessionStart": [hook()],
                "UserPromptSubmit": [hook()],
                "PreToolUse": [hook()],
                "PostToolUse": [hook()],
                "PostToolUseFailure": [hook()],
                "PermissionRequest": [hook()],
                "Notification": [hook()],
                "Stop": [hook()],
                "StopFailure": [hook()],
                "SessionEnd": [hook()]
            }
        });
        let settings_path = self
            .runtime_directory
            .join(format!("claude-{terminal_id}.settings.json"));
        fs::write(&settings_path, serde_json::to_vec_pretty(&settings)?)?;

        Ok(ClaudeRuntimeSettings {
            settings_path: settings_path.to_string_lossy().into_owned(),
            event_file: self.event_file.to_string_lossy().into_owned(),
        })
    }

    pub fn codex_notify_config(&self, terminal_id: &str) -> Result<String, HookError> {
        let executable = std::env::current_exe()?;
        let command = vec![
            executable.to_string_lossy().into_owned(),
            "codex-notify".into(),
            "--event-file".into(),
            self.event_file.to_string_lossy().into_owned(),
            "--terminal-id".into(),
            terminal_id.into(),
        ];
        // Literal TOML strings survive the Windows npm `.cmd` shim; JSON-style
        // double quotes are stripped before Codex receives the override.
        let values = command
            .iter()
            .map(|value| {
                (!value.contains("'''"))
                    .then(|| format!("'''{value}'''"))
                    .ok_or(HookError::InvalidNotifyValue)
            })
            .collect::<Result<Vec<_>, _>>()?
            .join(",");
        Ok(format!("notify=[{values}]"))
    }

    pub fn write_mcp_config(
        &self,
        terminal_id: &str,
        config_json: &str,
    ) -> Result<String, HookError> {
        let config = serde_json::from_str::<Value>(config_json)?;
        let path = self
            .runtime_directory
            .join(format!("claude-{terminal_id}.mcp.json"));
        fs::write(&path, serde_json::to_vec_pretty(&config)?)?;
        Ok(path.to_string_lossy().into_owned())
    }

    pub fn read_new_events(&self) -> Result<Vec<AgentEvent>, HookError> {
        if !self.event_file.exists() {
            return Ok(Vec::new());
        }

        let mut cursor = self.cursor.lock().map_err(|_| HookError::LockPoisoned)?;
        let file = File::open(&self.event_file)?;
        let file_length = file.metadata()?.len();
        if *cursor > file_length {
            *cursor = 0;
        }

        let mut reader = BufReader::new(file);
        reader.seek(SeekFrom::Start(*cursor))?;
        let mut events = Vec::new();
        let mut line = Vec::new();

        loop {
            let consumed = reader.read_until(b'\n', &mut line)?;
            if consumed == 0 {
                break;
            }
            if !line.ends_with(b"\n") {
                break;
            }

            if let Ok(stored) = serde_json::from_slice::<StoredHookEvent>(&line) {
                events.push(map_hook_event(stored));
            }
            *cursor += consumed as u64;
            line.clear();
        }

        Ok(events)
    }
}

pub fn capture_hook_event_from_cli() -> Result<(), HookError> {
    let arguments = std::env::args().skip(2).collect::<Vec<_>>();
    let event_file =
        argument_value(&arguments, "--event-file").ok_or(HookError::InvalidArguments)?;
    let terminal_id =
        argument_value(&arguments, "--terminal-id").ok_or(HookError::InvalidArguments)?;
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload = serde_json::from_str(&input).unwrap_or_else(|_| json!({ "raw": input }));
    append_stored_event(&event_file, terminal_id, "claude", payload)
}

pub fn capture_codex_notification_from_cli() -> Result<(), HookError> {
    let arguments = std::env::args().skip(2).collect::<Vec<_>>();
    let event_file =
        argument_value(&arguments, "--event-file").ok_or(HookError::InvalidArguments)?;
    let terminal_id =
        argument_value(&arguments, "--terminal-id").ok_or(HookError::InvalidArguments)?;
    let payload = arguments
        .last()
        .ok_or(HookError::InvalidArguments)
        .and_then(|value| serde_json::from_str(value).map_err(HookError::from))?;
    append_stored_event(&event_file, terminal_id, "codex", payload)
}

fn append_stored_event(
    event_file: &str,
    terminal_id: String,
    agent_type: &str,
    payload: Value,
) -> Result<(), HookError> {
    let received_at = unix_timestamp_millis();
    let event = StoredHookEvent {
        event_key: format!("{received_at}-{}", std::process::id()),
        agent_type: Some(agent_type.into()),
        terminal_id,
        received_at,
        payload,
    };

    if let Some(parent) = Path::new(&event_file).parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(event_file)?;
    let mut serialized = serde_json::to_vec(&event)?;
    serialized.push(b'\n');
    file.write_all(&serialized)?;
    Ok(())
}

fn map_hook_event(stored: StoredHookEvent) -> AgentEvent {
    if stored.agent_type.as_deref() == Some("codex") {
        return map_codex_event(stored);
    }

    let hook_name = stored
        .payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or("Unknown");
    let event_type = match hook_name {
        "SessionStart" => "session.started",
        "UserPromptSubmit" => "agent.thinking",
        "PreToolUse" => "tool.started",
        "PostToolUse" => "tool.completed",
        "PostToolUseFailure" => "tool.failed",
        "PermissionRequest" => "approval.required",
        "Notification" => match stored
            .payload
            .get("notification_type")
            .and_then(Value::as_str)
        {
            Some("permission_prompt") => "approval.required",
            Some("idle_prompt") => "user.input.required",
            _ => "agent.notification",
        },
        "Stop" => "task.completed",
        "StopFailure" => stop_failure_event_type(&stored.payload),
        "SessionEnd" => "session.ended",
        _ => "agent.event",
    };

    AgentEvent {
        event_key: stored.event_key,
        agent_type: "claude".into(),
        native_session_id: stored
            .payload
            .get("session_id")
            .and_then(Value::as_str)
            .map(str::to_owned),
        terminal_id: stored.terminal_id,
        event_type: event_type.into(),
        detail: stored.payload,
        created_at: stored.received_at,
    }
}

fn map_codex_event(stored: StoredHookEvent) -> AgentEvent {
    let event_type = match stored.payload.get("type").and_then(Value::as_str) {
        Some("agent-turn-complete") => "task.completed",
        _ => "agent.notification",
    };
    AgentEvent {
        event_key: stored.event_key,
        agent_type: "codex".into(),
        native_session_id: stored
            .payload
            .get("thread-id")
            .and_then(Value::as_str)
            .map(str::to_owned),
        terminal_id: stored.terminal_id,
        event_type: event_type.into(),
        detail: stored.payload,
        created_at: stored.received_at,
    }
}

fn stop_failure_event_type(payload: &Value) -> &'static str {
    let detail = ["error", "error_details", "last_assistant_message"]
        .iter()
        .filter_map(|field| payload.get(field).and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    if detail.contains("rate_limit")
        || detail.contains("rate limit")
        || detail.contains("too many requests")
        || detail.contains("429")
    {
        return "agent.rate_limited";
    }
    if detail.contains("timeout") || detail.contains("timed out") {
        return "agent.timeout";
    }
    "agent.failed"
}

fn argument_value(arguments: &[String], name: &str) -> Option<String> {
    arguments
        .windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn command_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn unix_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("termexo-{name}-{unique}"))
    }

    #[test]
    fn maps_permission_notifications_to_approval_events() {
        let stored = StoredHookEvent {
            event_key: "event-1".into(),
            agent_type: None,
            terminal_id: "terminal-1".into(),
            received_at: 10,
            payload: json!({
                "hook_event_name": "Notification",
                "notification_type": "permission_prompt",
                "session_id": "session-1"
            }),
        };

        let event = map_hook_event(stored);

        assert_eq!(event.event_type, "approval.required");
        assert_eq!(event.native_session_id.as_deref(), Some("session-1"));
    }

    #[test]
    fn maps_rate_limit_stop_failures_to_retryable_events() {
        let stored = StoredHookEvent {
            event_key: "event-rate-limit".into(),
            agent_type: None,
            terminal_id: "terminal-1".into(),
            received_at: 10,
            payload: json!({
                "hook_event_name": "StopFailure",
                "session_id": "session-1",
                "error": "rate_limit",
                "error_details": "429 Too Many Requests"
            }),
        };

        let event = map_hook_event(stored);

        assert_eq!(event.event_type, "agent.rate_limited");
    }

    #[test]
    fn maps_timeout_stop_failures_to_waiting_events() {
        let stored = StoredHookEvent {
            event_key: "event-timeout".into(),
            agent_type: None,
            terminal_id: "terminal-1".into(),
            received_at: 10,
            payload: json!({
                "hook_event_name": "StopFailure",
                "error_details": "API request timed out"
            }),
        };

        let event = map_hook_event(stored);

        assert_eq!(event.event_type, "agent.timeout");
    }

    #[test]
    fn writes_isolated_claude_hook_settings() {
        let directory = test_directory("hooks");
        let store = HookEventStore::new(&directory).unwrap();

        let runtime = store.prepare_claude_runtime("terminal-1").unwrap();
        let settings =
            serde_json::from_str::<Value>(&fs::read_to_string(runtime.settings_path).unwrap())
                .unwrap();

        assert!(settings.pointer("/hooks/SessionStart/0").is_some());
        assert!(settings.pointer("/hooks/PermissionRequest/0").is_some());
        assert!(settings.pointer("/hooks/SessionEnd/0").is_some());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn builds_a_codex_notify_override_for_the_terminal() {
        let directory = test_directory("codex-notify");
        let store = HookEventStore::new(&directory).unwrap();

        let config = store.codex_notify_config("terminal-9").unwrap();

        assert!(config.starts_with("notify=["));
        assert!(config.contains("'''"));
        assert!(config.contains("codex-notify"));
        assert!(config.contains("terminal-9"));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn maps_codex_turn_completion_to_a_completed_agent_event() {
        let stored = StoredHookEvent {
            event_key: "event-codex-complete".into(),
            agent_type: Some("codex".into()),
            terminal_id: "terminal-codex".into(),
            received_at: 10,
            payload: json!({
                "type": "agent-turn-complete",
                "thread-id": "thread-1",
                "turn-id": "turn-1"
            }),
        };

        let event = map_hook_event(stored);

        assert_eq!(event.agent_type, "codex");
        assert_eq!(event.event_type, "task.completed");
        assert_eq!(event.native_session_id.as_deref(), Some("thread-1"));
    }

    #[test]
    fn waits_for_a_complete_hook_event_before_advancing_the_cursor() {
        let directory = test_directory("partial-hook");
        let store = HookEventStore::new(&directory).unwrap();
        let stored = StoredHookEvent {
            event_key: "event-partial".into(),
            agent_type: None,
            terminal_id: "terminal-1".into(),
            received_at: 10,
            payload: json!({
                "hook_event_name": "SessionStart",
                "session_id": "session-1"
            }),
        };
        let serialized = serde_json::to_vec(&stored).unwrap();
        let split = serialized.len() / 2;
        fs::write(&store.event_file, &serialized[..split]).unwrap();

        assert!(store.read_new_events().unwrap().is_empty());

        let mut file = OpenOptions::new()
            .append(true)
            .open(&store.event_file)
            .unwrap();
        file.write_all(&serialized[split..]).unwrap();
        file.write_all(b"\n").unwrap();
        drop(file);

        let events = store.read_new_events().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_key, "event-partial");
        assert_eq!(events[0].native_session_id.as_deref(), Some("session-1"));
        assert!(store.read_new_events().unwrap().is_empty());

        fs::remove_dir_all(directory).unwrap();
    }
}
