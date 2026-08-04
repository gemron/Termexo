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
    #[error("credential store did not persist the saved secret")]
    CredentialNotPersisted,
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
    pub api_protocol: String,
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
    #[serde(default = "default_api_protocol")]
    pub api_protocol: String,
    pub is_default: bool,
}

fn default_api_protocol() -> String {
    "anthropic".into()
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
        match self.get_optional(target)? {
            Some(stored) if stored == secret => Ok(()),
            _ => Err(ConfigError::CredentialNotPersisted),
        }
    }

    pub fn get(&self, target: &str) -> Result<String, ConfigError> {
        self.get_optional(target)?
            .ok_or_else(|| ConfigError::Credential(keyring::Error::NoEntry))
    }

    pub fn get_optional(&self, target: &str) -> Result<Option<String>, ConfigError> {
        let entry = Entry::new(CREDENTIAL_SERVICE, target)?;
        normalize_credential_result(entry.get_password())
    }

    pub fn contains(&self, target: &str) -> Result<bool, ConfigError> {
        self.get_optional(target).map(|secret| secret.is_some())
    }

    pub fn delete(&self, target: &str) {
        if let Ok(entry) = Entry::new(CREDENTIAL_SERVICE, target) {
            let _ = entry.delete_credential();
        }
    }
}

fn normalize_credential_result(
    result: Result<String, keyring::Error>,
) -> Result<Option<String>, ConfigError> {
    match result {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(ConfigError::Credential(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_secure_storage_entry_is_an_empty_optional_credential() {
        assert!(normalize_credential_result(Err(keyring::Error::NoEntry))
            .expect("missing entries should not fail")
            .is_none());
    }

    #[test]
    fn existing_secure_storage_entry_is_returned() {
        assert_eq!(
            normalize_credential_result(Ok("secret".into()))
                .expect("stored credential should be readable")
                .as_deref(),
            Some("secret")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn native_windows_credential_store_is_enabled() {
        let _ = keyring::windows::default_credential_builder();
    }

    #[test]
    #[ignore = "uses the operating system credential store"]
    fn secure_storage_round_trips_a_credential() {
        let target = format!("credential-probe:{}", std::process::id());
        let store = CredentialStore;

        store
            .set(&target, "probe-secret")
            .expect("credential should be written");
        let stored = store
            .get_optional(&target)
            .expect("credential should be readable");
        store.delete(&target);

        assert_eq!(stored.as_deref(), Some("probe-secret"));
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
