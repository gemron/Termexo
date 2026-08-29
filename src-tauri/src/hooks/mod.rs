use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use url::Url;

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
    #[error("Codex runtime command contains an unsupported TOML delimiter")]
    InvalidCodexConfigValue,
    #[error("无法生成 OpenCode 运行时插件路径")]
    InvalidOpenCodePluginPath,
    #[error("无法合并 OPENCODE_CONFIG_CONTENT：{0}")]
    InvalidOpenCodeConfig(String),
}

const TERMEXO_CODEX_EVENT_FILE: &str = "TERMEXO_CODEX_EVENT_FILE";
const TERMEXO_CODEX_TERMINAL_ID: &str = "TERMEXO_CODEX_TERMINAL_ID";
const CODEX_HOOK_EVENTS: [&str; 11] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "SubagentStart",
    "SubagentStop",
    "Stop",
    "SessionEnd",
];

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

#[derive(Debug)]
pub struct OpenCodeRuntimeSettings {
    pub config_content: String,
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
            .map(|value| toml_literal(value))
            .collect::<Result<Vec<_>, _>>()?
            .join(",");
        Ok(format!("notify=[{values}]"))
    }

    pub fn codex_hook_configs(&self) -> Result<Vec<String>, HookError> {
        let executable = std::env::current_exe()?;
        let command = format!(
            "{} codex-hook-event",
            command_quote(&executable.to_string_lossy()),
        );
        let command = toml_literal(&command)?;
        Ok(CODEX_HOOK_EVENTS
            .iter()
            .map(|event| {
                format!(
                    "hooks.{event}=[{{hooks=[{{type='command',command={command},command_windows={command},timeout=10}}]}}]"
                )
            })
            .collect())
    }

    pub fn codex_hook_environment(&self, terminal_id: &str) -> [(String, String); 2] {
        [
            (
                TERMEXO_CODEX_EVENT_FILE.into(),
                self.event_file.to_string_lossy().into_owned(),
            ),
            (TERMEXO_CODEX_TERMINAL_ID.into(), terminal_id.into()),
        ]
    }

    pub fn prepare_opencode_runtime(
        &self,
        terminal_id: &str,
        session_id: Option<&str>,
        existing_config: Option<&str>,
    ) -> Result<OpenCodeRuntimeSettings, HookError> {
        let plugin_path = self
            .runtime_directory
            .join(format!("opencode-{terminal_id}.plugin.js"));
        let plugin = OPENCODE_PLUGIN_TEMPLATE
            .replace(
                "__EVENT_FILE__",
                &serde_json::to_string(&self.event_file.to_string_lossy())?,
            )
            .replace("__TERMINAL_ID__", &serde_json::to_string(terminal_id)?)
            .replace("__SESSION_ID__", &serde_json::to_string(&session_id)?);
        fs::write(&plugin_path, plugin)?;

        let plugin_url = Url::from_file_path(&plugin_path)
            .map_err(|_| HookError::InvalidOpenCodePluginPath)?
            .to_string();
        let config_content = merge_opencode_plugin_config(existing_config, &plugin_url)?;
        Ok(OpenCodeRuntimeSettings { config_content })
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

    pub fn write_codex_model_catalog(
        &self,
        terminal_id: &str,
        catalog: &Value,
    ) -> Result<String, HookError> {
        let path = self
            .runtime_directory
            .join(format!("codex-{terminal_id}.model-catalog.json"));
        fs::write(&path, serde_json::to_vec_pretty(catalog)?)?;
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

pub fn capture_codex_hook_event_from_cli() -> Result<(), HookError> {
    let event_file = env::var(TERMEXO_CODEX_EVENT_FILE).map_err(|_| HookError::InvalidArguments)?;
    let terminal_id =
        env::var(TERMEXO_CODEX_TERMINAL_ID).map_err(|_| HookError::InvalidArguments)?;
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input)?;
    let payload = serde_json::from_str(&input).unwrap_or_else(|_| json!({ "raw": input }));
    append_stored_event(&event_file, terminal_id, "codex", payload)?;
    println!("{{}}");
    Ok(())
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
    if stored.agent_type.as_deref() == Some("opencode") {
        return map_opencode_event(stored);
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

fn map_opencode_event(stored: StoredHookEvent) -> AgentEvent {
    AgentEvent {
        event_key: stored.event_key,
        agent_type: "opencode".into(),
        native_session_id: stored
            .payload
            .get("native_session_id")
            .and_then(Value::as_str)
            .map(str::to_owned),
        terminal_id: stored.terminal_id,
        event_type: stored
            .payload
            .get("event_type")
            .and_then(Value::as_str)
            .unwrap_or("agent.notification")
            .into(),
        detail: stored
            .payload
            .get("detail")
            .cloned()
            .unwrap_or_else(|| stored.payload.clone()),
        created_at: stored.received_at,
    }
}

fn merge_opencode_plugin_config(
    existing_config: Option<&str>,
    plugin_url: &str,
) -> Result<String, HookError> {
    let mut config = match existing_config.filter(|value| !value.trim().is_empty()) {
        Some(value) => serde_json::from_str::<Value>(value)
            .map_err(|error| HookError::InvalidOpenCodeConfig(error.to_string()))?,
        None => json!({}),
    };
    let object = config
        .as_object_mut()
        .ok_or_else(|| HookError::InvalidOpenCodeConfig("配置内容必须是 JSON 对象".into()))?;
    let plugins = object.entry("plugin").or_insert_with(|| json!([]));
    let plugins = plugins
        .as_array_mut()
        .ok_or_else(|| HookError::InvalidOpenCodeConfig("plugin 字段必须是数组".into()))?;
    if !plugins.iter().any(|plugin| {
        plugin.as_str() == Some(plugin_url)
            || plugin
                .as_array()
                .and_then(|values| values.first())
                .and_then(Value::as_str)
                == Some(plugin_url)
    }) {
        plugins.push(Value::String(plugin_url.into()));
    }
    serde_json::to_string(&config).map_err(HookError::from)
}

const OPENCODE_PLUGIN_TEMPLATE: &str = include_str!("opencode-plugin.mjs");

fn map_codex_event(stored: StoredHookEvent) -> AgentEvent {
    let event_type = match stored.payload.get("type").and_then(Value::as_str) {
        Some("agent-turn-complete") => "task.completed",
        _ => match stored
            .payload
            .get("hook_event_name")
            .and_then(Value::as_str)
        {
            Some("SessionStart") => "session.started",
            Some("UserPromptSubmit" | "PreCompact" | "PostCompact" | "SubagentStart") => {
                "agent.thinking"
            }
            Some("PreToolUse") => "tool.started",
            Some("PermissionRequest") => "approval.required",
            Some("PostToolUse") => {
                if codex_tool_failed(&stored.payload) {
                    "tool.failed"
                } else {
                    "tool.completed"
                }
            }
            Some("SubagentStop") => "agent.thinking",
            Some("Stop") => "task.completed",
            Some("SessionEnd") => "session.ended",
            _ => "agent.notification",
        },
    };
    AgentEvent {
        event_key: stored.event_key,
        agent_type: "codex".into(),
        native_session_id: stored
            .payload
            .get("thread-id")
            .and_then(Value::as_str)
            .or_else(|| stored.payload.get("session_id").and_then(Value::as_str))
            .map(str::to_owned),
        terminal_id: stored.terminal_id,
        event_type: event_type.into(),
        detail: stored.payload,
        created_at: stored.received_at,
    }
}

fn codex_tool_failed(payload: &Value) -> bool {
    let response = payload.get("tool_response").unwrap_or(&Value::Null);
    response
        .get("is_error")
        .or_else(|| response.get("isError"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || response
            .get("success")
            .and_then(Value::as_bool)
            .is_some_and(|success| !success)
        || response
            .get("exit_code")
            .or_else(|| response.get("exitCode"))
            .and_then(Value::as_i64)
            .is_some_and(|exit_code| exit_code != 0)
        || response
            .get("status")
            .and_then(Value::as_str)
            .is_some_and(|status| matches!(status, "error" | "failed"))
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

/// Wraps a value as a TOML literal string, which survives the Windows npm `.cmd` shim intact.
pub(crate) fn toml_literal(value: &str) -> Result<String, HookError> {
    (!value.contains("'''"))
        .then(|| format!("'''{value}'''"))
        .ok_or(HookError::InvalidCodexConfigValue)
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
    fn builds_codex_lifecycle_hook_overrides_and_terminal_environment() {
        let directory = test_directory("codex-hooks");
        let store = HookEventStore::new(&directory).unwrap();

        let configs = store.codex_hook_configs().unwrap();
        let environment = store
            .codex_hook_environment("terminal-11")
            .into_iter()
            .collect::<std::collections::HashMap<_, _>>();

        assert_eq!(configs.len(), CODEX_HOOK_EVENTS.len());
        assert!(configs
            .iter()
            .any(|config| config.starts_with("hooks.PermissionRequest=")));
        assert!(configs.iter().all(|config| config.contains("command=")));
        assert!(configs
            .iter()
            .all(|config| config.contains("command_windows=")));
        assert!(configs
            .iter()
            .all(|config| config.contains("codex-hook-event")));
        assert_eq!(
            environment
                .get(TERMEXO_CODEX_TERMINAL_ID)
                .map(String::as_str),
            Some("terminal-11")
        );
        assert_eq!(
            environment.get(TERMEXO_CODEX_EVENT_FILE).map(PathBuf::from),
            Some(store.event_file.clone())
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn writes_an_isolated_opencode_plugin_and_merges_inline_config() {
        let directory = test_directory("opencode-plugin");
        let store = HookEventStore::new(&directory).unwrap();

        let runtime = store
            .prepare_opencode_runtime(
                "terminal-open",
                Some("ses_open"),
                Some(r#"{"theme":"system","plugin":["existing-plugin"]}"#),
            )
            .unwrap();
        let config = serde_json::from_str::<Value>(&runtime.config_content).unwrap();
        let plugins = config["plugin"].as_array().unwrap();
        let generated_url = plugins.last().and_then(Value::as_str).unwrap();
        let generated_path = Url::parse(generated_url).unwrap().to_file_path().unwrap();
        let plugin = fs::read_to_string(generated_path).unwrap();

        assert_eq!(config["theme"], "system");
        assert_eq!(plugins[0], "existing-plugin");
        assert!(plugin.contains("terminal-open"));
        assert!(plugin.contains("ses_open"));
        assert!(plugin.contains("permission.asked"));
        assert!(plugin.contains("question.asked"));
        assert!(plugin.contains("message.part.updated"));
        assert!(!plugin.contains("__EVENT_FILE__"));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn maps_normalized_opencode_events_and_session_ids() {
        let event = map_hook_event(StoredHookEvent {
            event_key: "event-opencode-approval".into(),
            agent_type: Some("opencode".into()),
            terminal_id: "terminal-open".into(),
            received_at: 10,
            payload: json!({
                "event_type": "approval.required",
                "native_session_id": "ses_open",
                "detail": {
                    "source": "permission.asked",
                    "title": "执行命令"
                }
            }),
        });

        assert_eq!(event.agent_type, "opencode");
        assert_eq!(event.event_type, "approval.required");
        assert_eq!(event.native_session_id.as_deref(), Some("ses_open"));
        assert_eq!(event.detail["source"], "permission.asked");
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
    fn maps_codex_lifecycle_hooks_to_terminal_events() {
        let cases = [
            ("SessionStart", "session.started"),
            ("UserPromptSubmit", "agent.thinking"),
            ("PreToolUse", "tool.started"),
            ("PermissionRequest", "approval.required"),
            ("PostToolUse", "tool.completed"),
            ("PreCompact", "agent.thinking"),
            ("PostCompact", "agent.thinking"),
            ("SubagentStart", "agent.thinking"),
            ("SubagentStop", "agent.thinking"),
            ("Stop", "task.completed"),
            ("SessionEnd", "session.ended"),
        ];

        for (hook_name, expected_event_type) in cases {
            let event = map_hook_event(StoredHookEvent {
                event_key: format!("event-{hook_name}"),
                agent_type: Some("codex".into()),
                terminal_id: "terminal-codex".into(),
                received_at: 10,
                payload: json!({
                    "hook_event_name": hook_name,
                    "session_id": "session-codex"
                }),
            });

            assert_eq!(event.event_type, expected_event_type, "{hook_name}");
            assert_eq!(event.native_session_id.as_deref(), Some("session-codex"));
        }
    }

    #[test]
    fn maps_failed_codex_tools_to_failure_events() {
        let event = map_hook_event(StoredHookEvent {
            event_key: "event-tool-failed".into(),
            agent_type: Some("codex".into()),
            terminal_id: "terminal-codex".into(),
            received_at: 10,
            payload: json!({
                "hook_event_name": "PostToolUse",
                "session_id": "session-codex",
                "tool_response": { "success": false }
            }),
        });

        assert_eq!(event.event_type, "tool.failed");
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
