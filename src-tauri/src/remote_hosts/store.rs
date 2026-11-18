//! Saved remote Termexo hosts and their tokens.
//!
//! The list itself lives in `app_settings` (`remote_hosts`); each host's access token lives in the
//! platform keyring under `remote-host-token:<id>` and is never serialized back to the frontend.

use serde::{Deserialize, Serialize};
use url::Url;

use crate::config::CredentialStore;
use crate::database::WorkspaceDatabase;

pub const REMOTE_HOSTS_SETTING_KEY: &str = "remote_hosts";
pub const REMOTE_HOST_CREDENTIAL_PREFIX: &str = "remote-host-token:";

const ALLOWED_SCHEMES: [&str; 2] = ["http", "https"];
const RELAY_PATH_PREFIX: &str = "/d/";
const DEVICE_ID_LENGTH: usize = 26;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteHostKind {
    Lan,
    Relay,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHost {
    pub id: String,
    pub name: String,
    pub kind: RemoteHostKind,
    /// Normalized base URL, always ending with `/`: `http(s)://host[:port]/` or
    /// `http(s)://relay[:port]/d/<deviceId>/`.
    pub url: String,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
    pub created_at: i64,
    #[serde(default)]
    pub last_connected_at: Option<i64>,
}

/// What the edit dialog sends when creating or updating a host.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRemoteHostRequest {
    pub id: Option<String>,
    pub name: String,
    pub url: String,
    /// `None` or blank when editing an existing host without replacing its token.
    pub token: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

/// Normalized target URL together with whether it points at a relay device path or a direct host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedHostUrl {
    pub url: String,
    pub kind: RemoteHostKind,
    /// Value suitable for the `Origin` header (`scheme://host[:port]`).
    pub origin: String,
    pub secure: bool,
}

/// Validates and canonicalizes a remote Termexo base URL.
///
/// Accepts either `http(s)://host[:port][/]` (direct LAN / subdomain relay) or
/// `http(s)://host[:port]/d/<deviceId>[/]` (path-based relay). Strips any `#token=…` or `?token=…`
/// a user left in the address field so a token never lands in `app_settings`.
pub fn normalize_host_url(raw: &str) -> Result<NormalizedHostUrl, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("远程主机地址不能为空。".into());
    }
    let parsed = Url::parse(trimmed).map_err(|_| format!("远程主机地址「{trimmed}」不是有效的 URL。"))?;
    if !ALLOWED_SCHEMES.contains(&parsed.scheme()) {
        return Err("远程主机地址必须以 http:// 或 https:// 开头。".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("远程主机地址不能包含用户名或密码。".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "远程主机地址缺少主机名。".to_string())?;
    let origin = match parsed.port() {
        Some(port) => format!("{}://{host}:{port}", parsed.scheme()),
        None => format!("{}://{host}", parsed.scheme()),
    };
    let (path, kind) = classify_path(parsed.path())?;
    Ok(NormalizedHostUrl {
        url: format!("{origin}{path}"),
        kind,
        origin,
        secure: parsed.scheme() == "https",
    })
}

fn classify_path(raw_path: &str) -> Result<(String, RemoteHostKind), String> {
    let trimmed = raw_path.trim_end_matches('/');
    if trimmed.is_empty() {
        return Ok(("/".to_string(), RemoteHostKind::Lan));
    }
    if let Some(rest) = trimmed.strip_prefix(RELAY_PATH_PREFIX) {
        if is_valid_device_id(rest) {
            return Ok((format!("{RELAY_PATH_PREFIX}{rest}/"), RemoteHostKind::Relay));
        }
    }
    Err("远程主机地址的路径只能为空或中继的 /d/<设备ID>/。".into())
}

fn is_valid_device_id(candidate: &str) -> bool {
    candidate.len() == DEVICE_ID_LENGTH
        && candidate
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

pub fn credential_target(host_id: &str) -> String {
    format!("{REMOTE_HOST_CREDENTIAL_PREFIX}{host_id}")
}

pub fn load_hosts(database: &WorkspaceDatabase) -> Vec<RemoteHost> {
    let stored = match database.read_app_setting(REMOTE_HOSTS_SETTING_KEY) {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, "无法读取远程主机列表，使用空列表");
            return Vec::new();
        }
    };
    let mut hosts: Vec<RemoteHost> = stored
        .and_then(|value| match serde_json::from_str(&value) {
            Ok(list) => Some(list),
            Err(error) => {
                tracing::warn!(%error, "远程主机列表无法解析，使用空列表");
                None
            }
        })
        .unwrap_or_default();
    hosts.sort_by(|left, right| {
        left.sort_order
            .cmp(&right.sort_order)
            .then_with(|| left.created_at.cmp(&right.created_at))
    });
    hosts
}

pub fn store_hosts(database: &WorkspaceDatabase, hosts: &[RemoteHost]) -> Result<(), String> {
    let value =
        serde_json::to_string(hosts).map_err(|error| format!("无法序列化远程主机列表：{error}"))?;
    database
        .write_app_setting(REMOTE_HOSTS_SETTING_KEY, &value)
        .map_err(|error| format!("无法保存远程主机列表：{error}"))
}

pub fn read_token(credentials: &CredentialStore, host_id: &str) -> Result<Option<String>, String> {
    credentials
        .get_optional(&credential_target(host_id))
        .map_err(|error| format!("无法读取远程主机令牌：{error}"))
}

pub fn write_token(
    credentials: &CredentialStore,
    host_id: &str,
    token: &str,
) -> Result<(), String> {
    credentials
        .set(&credential_target(host_id), token)
        .map_err(|error| format!("无法保存远程主机令牌：{error}"))
}

pub fn delete_token(credentials: &CredentialStore, host_id: &str) {
    credentials.delete(&credential_target(host_id));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_lan_addresses_and_strips_any_pasted_token() {
        let parsed =
            normalize_host_url("https://192.168.1.20:7420/#token=secret").expect("valid LAN URL");

        assert_eq!(parsed.url, "https://192.168.1.20:7420/");
        assert_eq!(parsed.origin, "https://192.168.1.20:7420");
        assert_eq!(parsed.kind, RemoteHostKind::Lan);
        assert!(parsed.secure);
    }

    #[test]
    fn recognizes_a_relay_device_path_and_adds_its_trailing_slash() {
        let parsed =
            normalize_host_url("https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz")
                .expect("valid relay device URL");

        assert_eq!(
            parsed.url,
            "https://relay.example.com/d/abcdefghijklmnopqrstuvwxyz/"
        );
        assert_eq!(parsed.origin, "https://relay.example.com");
        assert_eq!(parsed.kind, RemoteHostKind::Relay);
    }

    #[test]
    fn refuses_unknown_schemes_and_arbitrary_paths() {
        assert!(normalize_host_url("ws://192.168.1.20:7420/").is_err());
        assert!(normalize_host_url("https://192.168.1.20:7420/other").is_err());
        assert!(normalize_host_url("https://relay.example.com/d/TOO-SHORT/").is_err());
    }
}
