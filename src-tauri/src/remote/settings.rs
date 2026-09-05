use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use serde::{Deserialize, Serialize};

use crate::database::WorkspaceDatabase;

/// `app_settings` key holding the serialized [`RemoteAccessSettings`].
pub const REMOTE_ACCESS_SETTING_KEY: &str = "remote_access";

/// Listening on every interface is what makes the workbench reachable from a phone; the feature
/// stays off by default so binding wide is only ever the user's explicit choice.
pub const BIND_ALL_INTERFACES: &str = "0.0.0.0";

pub const DEFAULT_PORT: u16 = 7420;
/// Ports below 1024 are privileged on the systems Termexo may later run on and offer nothing here.
pub const MIN_PORT: u16 = 1024;

fn default_bind_address() -> String {
    BIND_ALL_INTERFACES.to_string()
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

/// HTTPS by default: a page served over plain HTTP is not a secure context, so the browser hides
/// `crypto.randomUUID`, the clipboard API and notifications, and the remote workbench loses
/// terminal copy/paste and terminal creation.
fn default_tls() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_bind_address")]
    pub bind_address: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_tls")]
    pub tls: bool,
}

impl Default for RemoteAccessSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            bind_address: default_bind_address(),
            port: default_port(),
            tls: default_tls(),
        }
    }
}

impl RemoteAccessSettings {
    /// Rejects settings that could never produce a listening socket, before anything is persisted.
    pub fn validate(&self) -> Result<(), String> {
        self.parse_bind_address()?;
        if self.port < MIN_PORT {
            return Err(format!("端口必须在 {MIN_PORT}-65535 之间。"));
        }
        Ok(())
    }

    pub fn socket_address(&self) -> Result<SocketAddr, String> {
        Ok(SocketAddr::new(
            IpAddr::V4(self.parse_bind_address()?),
            self.port,
        ))
    }

    fn parse_bind_address(&self) -> Result<Ipv4Addr, String> {
        self.bind_address
            .trim()
            .parse::<Ipv4Addr>()
            .map_err(|_| format!("绑定地址「{}」不是有效的 IPv4 地址。", self.bind_address))
    }
}

/// Reads the stored settings, falling back to the defaults.
///
/// A document written by a newer build, or corrupted on disk, must not keep the app from starting:
/// remote access is opt-in, so the safe fallback is the disabled default.
pub fn load(database: &WorkspaceDatabase) -> RemoteAccessSettings {
    let stored = match database.read_app_setting(REMOTE_ACCESS_SETTING_KEY) {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "无法读取远程访问设置，使用默认值");
            return RemoteAccessSettings::default();
        }
    };
    stored
        .and_then(|value| match serde_json::from_str(&value) {
            Ok(settings) => Some(settings),
            Err(error) => {
                tracing::warn!(%error, "远程访问设置无法解析，使用默认值");
                None
            }
        })
        .unwrap_or_default()
}

pub fn store(database: &WorkspaceDatabase, settings: &RemoteAccessSettings) -> Result<(), String> {
    let value = serde_json::to_string(settings)
        .map_err(|error| format!("无法序列化远程访问设置：{error}"))?;
    database
        .write_app_setting(REMOTE_ACCESS_SETTING_KEY, &value)
        .map_err(|error| format!("无法保存远程访问设置：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOOPBACK_ADDRESS: &str = "127.0.0.1";

    #[test]
    fn defaults_are_disabled_https_on_every_interface() {
        let settings = RemoteAccessSettings::default();

        assert!(!settings.enabled);
        assert!(settings.tls);
        assert_eq!(settings.bind_address, BIND_ALL_INTERFACES);
        assert_eq!(settings.port, DEFAULT_PORT);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let settings: RemoteAccessSettings =
            serde_json::from_str("{}").expect("an empty document should deserialize");

        assert_eq!(settings, RemoteAccessSettings::default());
    }

    #[test]
    fn settings_round_trip_through_camel_case_json() {
        let settings = RemoteAccessSettings {
            enabled: true,
            bind_address: LOOPBACK_ADDRESS.into(),
            port: 8443,
            tls: false,
        };

        let encoded = serde_json::to_string(&settings).expect("settings should serialize");

        assert!(encoded.contains("\"bindAddress\""));
        assert_eq!(
            serde_json::from_str::<RemoteAccessSettings>(&encoded).expect("should deserialize"),
            settings
        );
    }

    #[test]
    fn rejects_privileged_ports() {
        let settings = RemoteAccessSettings {
            port: 80,
            ..RemoteAccessSettings::default()
        };

        assert!(settings.validate().is_err());
    }

    #[test]
    fn rejects_addresses_that_are_not_ipv4() {
        let settings = RemoteAccessSettings {
            bind_address: "not-an-address".into(),
            ..RemoteAccessSettings::default()
        };

        assert!(settings.validate().is_err());
    }

    #[test]
    fn builds_the_socket_address_from_bind_address_and_port() {
        let settings = RemoteAccessSettings {
            bind_address: LOOPBACK_ADDRESS.into(),
            port: 7420,
            ..RemoteAccessSettings::default()
        };

        assert_eq!(
            settings
                .socket_address()
                .expect("a valid address should resolve")
                .to_string(),
            "127.0.0.1:7420"
        );
    }
}
