//! Shared delivery gate for external notification channels. Channel configuration
//! remains independent so pausing/resuming never changes destinations or events.
pub mod content;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::database::WorkspaceDatabase;

const SETTINGS_KEY: &str = "third-party-notifications.v1";

#[derive(Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ThirdPartyNotificationsSettings {
    pub enabled: bool,
}

impl Default for ThirdPartyNotificationsSettings {
    fn default() -> Self {
        // Preserve existing channel behavior on upgrade. Channels still require
        // their own explicit opt-in before anything can be sent.
        Self { enabled: true }
    }
}

fn settings(database: &WorkspaceDatabase) -> Result<ThirdPartyNotificationsSettings, String> {
    database
        .read_app_setting(SETTINGS_KEY)
        .map_err(|error| error.to_string())?
        .map(|value| {
            serde_json::from_str(&value)
                .map_err(|_| "第三方通知总开关无法读取，已停止发送。".into())
        })
        .unwrap_or_else(|| Ok(ThirdPartyNotificationsSettings::default()))
}

/// Every external channel must check this gate, including sends requested by MCP.
pub fn ensure_enabled(database: &WorkspaceDatabase) -> Result<(), String> {
    if settings(database)?.enabled {
        Ok(())
    } else {
        Err("第三方通知已暂停；请通过顶部总开关恢复。".into())
    }
}

#[tauri::command(async)]
pub fn read_third_party_notifications(
    database: State<'_, WorkspaceDatabase>,
) -> Result<ThirdPartyNotificationsSettings, String> {
    settings(&database)
}

#[tauri::command(async)]
pub fn set_third_party_notifications_enabled(
    enabled: bool,
    database: State<'_, WorkspaceDatabase>,
) -> Result<ThirdPartyNotificationsSettings, String> {
    let value = ThirdPartyNotificationsSettings { enabled };
    database
        .write_app_setting(
            SETTINGS_KEY,
            &serde_json::to_string(&value).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn master_gate_persists_without_changing_channel_configuration_and_fails_closed() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let file = std::env::temp_dir().join(format!(
            "termexo-notification-gate-{}-{nonce}.db",
            std::process::id()
        ));
        let database = WorkspaceDatabase::open(file.clone()).unwrap();
        assert!(ensure_enabled(&database).is_ok());
        let channel = r#"{"enabled":true,"target":"existing destination"}"#;
        database
            .write_app_setting("wechat-notifications.v1", channel)
            .unwrap();
        database
            .write_app_setting(SETTINGS_KEY, r#"{"enabled":false}"#)
            .unwrap();
        assert!(ensure_enabled(&database).is_err());
        drop(database);
        let database = WorkspaceDatabase::open(file.clone()).unwrap();
        assert!(!settings(&database).unwrap().enabled);
        database
            .write_app_setting(SETTINGS_KEY, r#"{"enabled":true}"#)
            .unwrap();
        assert!(ensure_enabled(&database).is_ok());
        assert_eq!(
            database
                .read_app_setting("wechat-notifications.v1")
                .unwrap()
                .as_deref(),
            Some(channel)
        );
        database.write_app_setting(SETTINGS_KEY, "invalid").unwrap();
        assert!(ensure_enabled(&database).is_err());
        drop(database);
        std::fs::remove_file(file).unwrap();
    }
}
