use std::collections::HashMap;

use serde::Deserialize;
use tauri::State;

use crate::agent::{
    AgentAdapter, AgentInstallation, AgentLaunchSpec, AgentSession, ClaudeCodeAdapter,
    ClaudeLaunchOptions,
};
use crate::config::{CredentialStore, LaunchEnvironmentStore, ModelProfile};
use crate::database::WorkspaceDatabase;
use crate::hooks::HookEventStore;

#[tauri::command]
pub async fn detect_claude() -> Result<AgentInstallation, String> {
    tauri::async_runtime::spawn_blocking(|| {
        ClaudeCodeAdapter::new()
            .detect()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn scan_claude_sessions(
    project_path: Option<String>,
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    let sessions = ClaudeCodeAdapter::new()
        .list_sessions(project_path.as_deref())
        .map_err(|error| error.to_string())?;
    database
        .save_agent_sessions(&sessions)
        .map_err(|error| error.to_string())?;
    Ok(sessions)
}

#[tauri::command]
pub fn list_agent_sessions(
    database: State<'_, WorkspaceDatabase>,
) -> Result<Vec<AgentSession>, String> {
    database
        .list_agent_sessions()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn build_claude_launch_command(
    options: ClaudeLaunchOptions,
) -> Result<AgentLaunchSpec, String> {
    ClaudeCodeAdapter::new()
        .build_launch_command(&options)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareClaudeLaunchRequest {
    pub terminal_id: String,
    pub session_id: Option<String>,
    pub name: Option<String>,
    pub profile_id: Option<String>,
    pub mcp_profile_id: Option<String>,
}

#[tauri::command]
pub fn prepare_claude_launch(
    request: PrepareClaudeLaunchRequest,
    database: State<'_, WorkspaceDatabase>,
    hooks: State<'_, HookEventStore>,
    credentials: State<'_, CredentialStore>,
    launch_environment: State<'_, LaunchEnvironmentStore>,
) -> Result<AgentLaunchSpec, String> {
    let profiles = database
        .list_model_profiles()
        .map_err(|error| error.to_string())?;
    let profile = request
        .profile_id
        .as_deref()
        .and_then(|profile_id| profiles.iter().find(|profile| profile.id == profile_id))
        .or_else(|| profiles.iter().find(|profile| profile.is_default))
        .cloned();
    let runtime = hooks
        .prepare_claude_runtime(&request.terminal_id)
        .map_err(|error| error.to_string())?;
    let mcp_config_path = match request.mcp_profile_id.as_deref() {
        Some(profile_id) => {
            let profile = database
                .find_mcp_profile(profile_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "MCP Profile 不存在".to_owned())?;
            Some(
                hooks
                    .write_mcp_config(&request.terminal_id, &profile.config_json)
                    .map_err(|error| error.to_string())?,
            )
        }
        None => None,
    };
    let mut environment = profile_environment(profile.as_ref());
    if let Some(profile) = profile.as_ref() {
        if let Some(target) = profile.credential_target.as_deref() {
            let token = credentials.get(target).map_err(|error| error.to_string())?;
            environment.insert("ANTHROPIC_AUTH_TOKEN".into(), token);
        }
    }
    launch_environment
        .put(request.terminal_id, environment)
        .map_err(|error| error.to_string())?;

    ClaudeCodeAdapter::new()
        .build_launch_command(&ClaudeLaunchOptions {
            session_id: request.session_id,
            name: request.name,
            model: profile.map(|profile| profile.model),
            settings_path: Some(runtime.settings_path),
            mcp_config_path,
        })
        .map_err(|error| error.to_string())
}

fn profile_environment(profile: Option<&ModelProfile>) -> HashMap<String, String> {
    let mut environment = HashMap::new();
    let Some(profile) = profile else {
        return environment;
    };
    let Some(base_url) = profile
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return environment;
    };

    environment.insert("ANTHROPIC_BASE_URL".into(), base_url.into());
    environment.insert("API_TIMEOUT_MS".into(), "3000000".into());
    environment.insert(
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".into(),
        "1".into(),
    );

    let model = profile.model.trim();
    if !model.is_empty() {
        for key in [
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "CLAUDE_CODE_SUBAGENT_MODEL",
        ] {
            environment.insert(key.into(), model.into());
        }
        if model.contains("[1m]") {
            environment.insert("CLAUDE_CODE_AUTO_COMPACT_WINDOW".into(), "1000000".into());
        }
    }

    if profile.provider.eq_ignore_ascii_case("DeepSeek") {
        environment.insert("CLAUDE_CODE_EFFORT_LEVEL".into(), "max".into());
    }
    environment
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_anthropic_compatible_profile_to_claude_environment() {
        let profile = ModelProfile {
            id: "deepseek".into(),
            name: "DeepSeek V4 Pro".into(),
            provider: "DeepSeek".into(),
            model: "deepseek-v4-pro[1m]".into(),
            base_url: Some("https://api.deepseek.com/anthropic".into()),
            credential_target: Some("profile:deepseek".into()),
            is_default: false,
            has_credential: true,
        };

        let environment = profile_environment(Some(&profile));

        assert_eq!(
            environment.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://api.deepseek.com/anthropic")
        );
        assert_eq!(
            environment.get("ANTHROPIC_MODEL").map(String::as_str),
            Some("deepseek-v4-pro[1m]")
        );
        assert_eq!(
            environment
                .get("ANTHROPIC_DEFAULT_SONNET_MODEL")
                .map(String::as_str),
            Some("deepseek-v4-pro[1m]")
        );
        assert_eq!(
            environment
                .get("CLAUDE_CODE_AUTO_COMPACT_WINDOW")
                .map(String::as_str),
            Some("1000000")
        );
        assert_eq!(
            environment
                .get("CLAUDE_CODE_EFFORT_LEVEL")
                .map(String::as_str),
            Some("max")
        );
    }

    #[test]
    fn leaves_official_anthropic_environment_untouched() {
        let profile = ModelProfile {
            id: "claude-default".into(),
            name: "Claude Sonnet".into(),
            provider: "Anthropic".into(),
            model: "sonnet".into(),
            base_url: None,
            credential_target: None,
            is_default: true,
            has_credential: false,
        };

        assert!(profile_environment(Some(&profile)).is_empty());
    }
}
