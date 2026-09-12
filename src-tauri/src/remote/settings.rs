use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::database::WorkspaceDatabase;

/// `app_settings` key holding the serialized [`RemoteAccessSettings`].
pub const REMOTE_ACCESS_SETTING_KEY: &str = "remote_access";

/// `app_settings` key holding the name this device presents to the relay.
///
/// It is deliberately outside [`RemoteAccessSettings`]: the panel's settings payload does not
/// carry the name — it is chosen once, during enrollment — so a plain settings save must not be
/// able to blank it.
pub const RELAY_DEVICE_NAME_KEY: &str = "remote_relay_device_name";

/// Listening on every interface is what makes the workbench reachable from a phone; the feature
/// stays off by default so binding wide is only ever the user's explicit choice.
pub const BIND_ALL_INTERFACES: &str = "0.0.0.0";

pub const DEFAULT_PORT: u16 = 7420;
/// Ports below 1024 are privileged on the systems Termexo may later run on and offer nothing here.
pub const MIN_PORT: u16 = 1024;

/// The only schemes a relay address may use; the tunnel derives `ws` / `wss` from them.
const RELAY_SCHEMES: [&str; 2] = ["http", "https"];
/// A SHA-256 digest rendered as lowercase hex.
const CERTIFICATE_FINGERPRINT_LENGTH: usize = 64;
/// Accepted inside a pasted fingerprint because certificate viewers print it grouped by byte.
const FINGERPRINT_SEPARATOR: char = ':';

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

/// How the workbench reaches a relay, so it can be opened from outside the local network.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaySettings {
    pub enabled: bool,
    /// The relay's public base address, `http(s)://host[:port]`, without a trailing slash.
    #[serde(default)]
    pub url: String,
    /// Pinned SHA-256 of the relay's leaf certificate, for a self-signed relay on a home network.
    #[serde(default)]
    pub certificate_fingerprint: Option<String>,
}

impl RelaySettings {
    /// Validates the relay address and returns the canonical form of these settings.
    ///
    /// Normalizing here rather than at every use keeps the stored document, the panel's display
    /// and the addresses the tunnel derives from it in one spelling.
    pub fn normalized(&self) -> Result<Self, String> {
        let fingerprint = match self.certificate_fingerprint.as_deref() {
            Some(raw) if !raw.trim().is_empty() => Some(normalized_fingerprint(raw)?),
            _ => None,
        };
        let url = match self.url.trim() {
            "" if !self.enabled => String::new(),
            raw => normalized_relay_url(raw)?,
        };
        Ok(Self {
            enabled: self.enabled,
            url,
            certificate_fingerprint: fingerprint,
        })
    }
}

/// Rejects anything that is not a bare `http(s)://host[:port]`, and drops the optional trailing
/// slash so the tunnel and enrollment paths can be appended without producing a double slash.
fn normalized_relay_url(raw: &str) -> Result<String, String> {
    let parsed = Url::parse(raw).map_err(|_| format!("中继地址「{raw}」不是有效的 URL。"))?;
    if !RELAY_SCHEMES.contains(&parsed.scheme()) {
        return Err("中继地址必须以 http:// 或 https:// 开头。".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("中继地址不能包含用户名或密码。".into());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("中继地址不能包含查询参数或片段。".into());
    }
    // `Url` turns an authority-only address into the path `/`, so anything longer is a real path.
    if parsed.path() != "/" {
        return Err("中继地址只能是主机和端口，不能包含路径。".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "中继地址缺少主机名。".to_string())?;
    // `Url::port` is `None` for the scheme's default port, which is exactly the form to store.
    Ok(match parsed.port() {
        Some(port) => format!("{}://{host}:{port}", parsed.scheme()),
        None => format!("{}://{host}", parsed.scheme()),
    })
}

/// Accepts a fingerprint in either spelling a certificate viewer offers and stores the compact one.
fn normalized_fingerprint(raw: &str) -> Result<String, String> {
    let compact: String = raw
        .chars()
        .filter(|character| *character != FINGERPRINT_SEPARATOR && !character.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    if compact.len() != CERTIFICATE_FINGERPRINT_LENGTH
        || !compact
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(format!(
            "证书指纹必须是 {CERTIFICATE_FINGERPRINT_LENGTH} 位十六进制的 SHA-256 值。"
        ));
    }
    Ok(compact)
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
    /// Settings written before relays existed have no `relay` block; the default is switched off.
    #[serde(default)]
    pub relay: RelaySettings,
}

impl Default for RemoteAccessSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            bind_address: default_bind_address(),
            port: default_port(),
            tls: default_tls(),
            relay: RelaySettings::default(),
        }
    }
}

impl RemoteAccessSettings {
    /// The canonical form to persist and to run with.
    ///
    /// Settings that could never produce a listening socket or reach a relay are refused here,
    /// before anything is written.
    pub fn normalized(&self) -> Result<Self, String> {
        self.parse_bind_address()?;
        if self.port < MIN_PORT {
            return Err(format!("端口必须在 {MIN_PORT}-65535 之间。"));
        }
        Ok(Self {
            enabled: self.enabled,
            bind_address: self.bind_address.trim().to_string(),
            port: self.port,
            tls: self.tls,
            relay: self.relay.normalized()?,
        })
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

/// The name this device announced to the relay, if it has ever enrolled.
pub fn load_relay_device_name(database: &WorkspaceDatabase) -> Option<String> {
    database
        .read_app_setting(RELAY_DEVICE_NAME_KEY)
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "无法读取中继设备名");
            None
        })
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

pub fn store_relay_device_name(database: &WorkspaceDatabase, name: &str) -> Result<(), String> {
    database
        .write_app_setting(RELAY_DEVICE_NAME_KEY, name)
        .map_err(|error| format!("无法保存中继设备名：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOOPBACK_ADDRESS: &str = "127.0.0.1";
    const SAMPLE_FINGERPRINT: &str =
        "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    fn enabled_relay(url: &str) -> RelaySettings {
        RelaySettings {
            enabled: true,
            url: url.into(),
            certificate_fingerprint: None,
        }
    }

    #[test]
    fn defaults_are_disabled_https_on_every_interface() {
        let settings = RemoteAccessSettings::default();

        assert!(!settings.enabled);
        assert!(settings.tls);
        assert_eq!(settings.bind_address, BIND_ALL_INTERFACES);
        assert_eq!(settings.port, DEFAULT_PORT);
        assert!(!settings.relay.enabled);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let settings: RemoteAccessSettings =
            serde_json::from_str("{}").expect("an empty document should deserialize");

        assert_eq!(settings, RemoteAccessSettings::default());
    }

    /// Settings written before relays existed must keep working untouched.
    #[test]
    fn a_document_without_a_relay_block_still_loads() {
        let settings: RemoteAccessSettings = serde_json::from_str(
            "{\"enabled\":true,\"bindAddress\":\"0.0.0.0\",\"port\":7420,\"tls\":true}",
        )
        .expect("a pre-relay document should deserialize");

        assert!(settings.enabled);
        assert_eq!(settings.relay, RelaySettings::default());
    }

    #[test]
    fn settings_round_trip_through_camel_case_json() {
        let settings = RemoteAccessSettings {
            enabled: true,
            bind_address: LOOPBACK_ADDRESS.into(),
            port: 8443,
            tls: false,
            relay: RelaySettings {
                enabled: true,
                url: "https://relay.example.com".into(),
                certificate_fingerprint: Some(SAMPLE_FINGERPRINT.into()),
            },
        };

        let encoded = serde_json::to_string(&settings).expect("settings should serialize");

        assert!(encoded.contains("\"bindAddress\""));
        assert!(encoded.contains("\"certificateFingerprint\""));
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

        assert!(settings.normalized().is_err());
    }

    #[test]
    fn rejects_addresses_that_are_not_ipv4() {
        let settings = RemoteAccessSettings {
            bind_address: "not-an-address".into(),
            ..RemoteAccessSettings::default()
        };

        assert!(settings.normalized().is_err());
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

    #[test]
    fn a_trailing_slash_and_a_default_port_are_normalized_away() {
        assert_eq!(
            enabled_relay("https://relay.example.com/")
                .normalized()
                .expect("a bare address should be accepted")
                .url,
            "https://relay.example.com"
        );
        assert_eq!(
            enabled_relay("https://Relay.Example.com:443")
                .normalized()
                .expect("a default port should be accepted")
                .url,
            "https://relay.example.com"
        );
        assert_eq!(
            enabled_relay("  http://192.168.1.20:8443  ")
                .normalized()
                .expect("a non-default port should be kept")
                .url,
            "http://192.168.1.20:8443"
        );
    }

    #[test]
    fn a_relay_address_may_only_be_a_host_and_a_port() {
        for address in [
            "relay.example.com",
            "ftp://relay.example.com",
            "https://relay.example.com/tunnel",
            "https://relay.example.com/?a=1",
            "https://relay.example.com/#token",
            "https://user:pass@relay.example.com",
            "",
        ] {
            assert!(
                enabled_relay(address).normalized().is_err(),
                "{address} should be refused"
            );
        }
    }

    /// A disabled relay keeps whatever the panel had in its address box without complaining.
    #[test]
    fn an_empty_address_is_only_an_error_once_the_relay_is_switched_on() {
        let disabled = RelaySettings::default();

        assert_eq!(
            disabled
                .normalized()
                .expect("a disabled relay needs no address")
                .url,
            ""
        );
        assert!(enabled_relay("").normalized().is_err());
    }

    #[test]
    fn a_fingerprint_is_stored_without_separators_and_in_lowercase() {
        let grouped = SAMPLE_FINGERPRINT
            .to_uppercase()
            .as_bytes()
            .chunks(2)
            .map(|pair| String::from_utf8_lossy(pair).into_owned())
            .collect::<Vec<_>>()
            .join(":");
        let settings = RelaySettings {
            certificate_fingerprint: Some(grouped),
            ..enabled_relay("https://relay.example.com")
        };

        assert_eq!(
            settings
                .normalized()
                .expect("a grouped fingerprint should be accepted")
                .certificate_fingerprint
                .as_deref(),
            Some(SAMPLE_FINGERPRINT)
        );
    }

    #[test]
    fn a_fingerprint_that_is_not_a_sha256_digest_is_refused() {
        for fingerprint in [
            "abc",
            &SAMPLE_FINGERPRINT[..63],
            &format!("{SAMPLE_FINGERPRINT}0"),
        ] {
            let settings = RelaySettings {
                certificate_fingerprint: Some(fingerprint.to_string()),
                ..enabled_relay("https://relay.example.com")
            };
            assert!(
                settings.normalized().is_err(),
                "{fingerprint} should be refused"
            );
        }
    }

    /// A blank box in the panel means "no pinned certificate", not an empty fingerprint.
    #[test]
    fn a_blank_fingerprint_becomes_no_fingerprint() {
        let settings = RelaySettings {
            certificate_fingerprint: Some("   ".into()),
            ..enabled_relay("https://relay.example.com")
        };

        assert_eq!(
            settings
                .normalized()
                .expect("a blank fingerprint should be accepted")
                .certificate_fingerprint,
            None
        );
    }
}
