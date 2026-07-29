use std::collections::HashMap;
use std::sync::Mutex;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const CREDENTIAL_SERVICE: &str = "dev.agentdock.desktop";

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("credential store operation failed: {0}")]
    Credential(#[from] keyring::Error),
    #[error("launch environment lock is poisoned")]
    LockPoisoned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfile {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub credential_target: Option<String>,
    pub is_default: bool,
    pub has_credential: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileInput {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_credential: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProfile {
    pub id: String,
    pub name: String,
    pub config_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProfileInput {
    pub id: String,
    pub name: String,
    pub config_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfile {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub workspace_id: Option<String>,
    pub enabled: bool,
    pub is_default: bool,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub all_proxy: Option<String>,
    pub no_proxy: Option<String>,
    pub npm_registry: Option<String>,
    pub npm_proxy: Option<String>,
    pub npm_https_proxy: Option<String>,
    pub npm_strict_ssl: bool,
    pub npm_ca_path: Option<String>,
    pub proxy_username: Option<String>,
    pub credential_target: Option<String>,
    pub has_credential: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfileInput {
    pub id: String,
    pub name: String,
    pub scope: String,
    pub workspace_id: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub is_default: bool,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub all_proxy: Option<String>,
    pub no_proxy: Option<String>,
    pub npm_registry: Option<String>,
    pub npm_proxy: Option<String>,
    pub npm_https_proxy: Option<String>,
    #[serde(default = "default_true")]
    pub npm_strict_ssl: bool,
    pub npm_ca_path: Option<String>,
    pub proxy_username: Option<String>,
    pub proxy_password: Option<String>,
    #[serde(default)]
    pub clear_credential: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub id: String,
    pub name: String,
    pub agent_type: String,
    pub config_dir: Option<String>,
    pub is_default: bool,
    pub is_system: bool,
    #[serde(default)]
    pub authenticated: bool,
    #[serde(default)]
    pub diagnostic: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileInput {
    pub id: String,
    pub name: String,
    pub agent_type: String,
    #[serde(default)]
    pub is_default: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Default)]
pub struct CredentialStore;

impl CredentialStore {
    pub fn set(&self, target: &str, secret: &str) -> Result<(), ConfigError> {
        Entry::new(CREDENTIAL_SERVICE, target)?.set_password(secret)?;
        Ok(())
    }

    pub fn get(&self, target: &str) -> Result<String, ConfigError> {
        Ok(Entry::new(CREDENTIAL_SERVICE, target)?.get_password()?)
    }

    pub fn delete(&self, target: &str) {
        if let Ok(entry) = Entry::new(CREDENTIAL_SERVICE, target) {
            let _ = entry.delete_credential();
        }
    }
}

#[derive(Default)]
pub struct LaunchEnvironmentStore {
    values: Mutex<HashMap<String, HashMap<String, String>>>,
}

impl LaunchEnvironmentStore {
    pub fn put(
        &self,
        terminal_id: String,
        environment: HashMap<String, String>,
    ) -> Result<(), ConfigError> {
        self.values
            .lock()
            .map_err(|_| ConfigError::LockPoisoned)?
            .insert(terminal_id, environment);
        Ok(())
    }

    pub fn take(&self, terminal_id: &str) -> Result<HashMap<String, String>, ConfigError> {
        Ok(self
            .values
            .lock()
            .map_err(|_| ConfigError::LockPoisoned)?
            .remove(terminal_id)
            .unwrap_or_default())
    }
}
