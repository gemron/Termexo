mod claude;
mod codex;

use serde::{Deserialize, Serialize};

pub use claude::ClaudeCodeAdapter;
pub use codex::CodexCliAdapter;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallation {
    pub agent_type: String,
    pub installed: bool,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub healthy: bool,
    pub diagnostic: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub agent_type: String,
    pub native_session_id: String,
    pub account_profile_id: Option<String>,
    pub project_path: Option<String>,
    pub model_name: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub branch: Option<String>,
    pub status: String,
    pub message_count: u32,
    pub transcript_path: String,
    pub created_at: i64,
    pub last_used_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLaunchOptions {
    pub session_id: Option<String>,
    pub name: Option<String>,
    pub model: Option<String>,
    pub settings_path: Option<String>,
    pub mcp_config_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLaunchOptions {
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub notify_config: Option<String>,
    pub hook_configs: Vec<String>,
    /// `-c` overrides pointing Codex at a compatible provider, empty for the official endpoint.
    pub provider_configs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunchSpec {
    pub command: String,
    pub executable_path: String,
}

pub trait AgentAdapter {
    type Error;
    type LaunchOptions;

    fn detect(&self) -> Result<AgentInstallation, Self::Error>;
    fn list_sessions(&self, project_path: Option<&str>) -> Result<Vec<AgentSession>, Self::Error>;
    fn build_launch_command(
        &self,
        options: &Self::LaunchOptions,
    ) -> Result<AgentLaunchSpec, Self::Error>;
}
