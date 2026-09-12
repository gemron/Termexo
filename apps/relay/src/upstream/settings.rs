//! What the relay remembers about its upstream, and where it is kept.
//!
//! A relay is an unattended service with no keyring, so the device credential it got from its
//! upstream lives in the database next to the address it belongs to — the data directory's file
//! permissions are what protect it. Nothing here ever reaches the console: the API renders the
//! address and the state, never the credential.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use termexo_relay_protocol::credential::DeviceCredential;
use termexo_relay_protocol::tunnel::{ENROLL_PATH, TUNNEL_PATH};

use crate::config::PublicUrl;
use crate::db::{Database, DatabaseError, SETTING_UPSTREAM};

const HTTPS_SCHEME: &str = "https://";
const SECURE_WEBSOCKET_SCHEME: &str = "wss://";
const PLAIN_WEBSOCKET_SCHEME: &str = "ws://";
const SCHEME_SEPARATOR: &str = "://";

/// Stands in for the credential in `Debug` output, the way the shared crate redacts its secrets.
const REDACTED: &str = "<redacted>";

const INVALID_CREDENTIAL: &str = "上游中继返回的设备凭据格式不正确。";
const UNREADABLE_SETTINGS: &str = "已保存的上游中继配置无法解析：";

/// The upstream this relay dials, as stored under `relay_settings.upstream`.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamSettings {
    /// Normalized origin, for example `https://relay-a.example.com`.
    pub url: String,
    /// `tdc1.<deviceId>.<secret>`, issued by the upstream's `/api/enroll`.
    pub credential: String,
    /// Pins a self-signed upstream's leaf certificate, the way the desktop panel pins a relay's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub certificate_fingerprint: Option<String>,
}

/// Written by hand for the same reason the enrollment types are: these values pass through log and
/// error paths, and the credential must never be carried into one.
impl fmt::Debug for UpstreamSettings {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("UpstreamSettings")
            .field("url", &self.url)
            .field("credential", &REDACTED)
            .field("certificate_fingerprint", &self.certificate_fingerprint)
            .finish()
    }
}

impl UpstreamSettings {
    /// Normalizes the address and checks the credential before anything is stored or dialled.
    pub fn build(
        url: &str,
        credential: String,
        certificate_fingerprint: Option<String>,
    ) -> Result<Self, String> {
        let origin = PublicUrl::from_str(url).map_err(|error| error.to_string())?;
        let credential = credential.trim().to_string();
        DeviceCredential::parse(&credential).map_err(|_| INVALID_CREDENTIAL.to_string())?;
        Ok(Self {
            url: origin.origin().to_string(),
            credential,
            certificate_fingerprint,
        })
    }

    /// The host and port, which is all a log line may carry about an upstream.
    pub fn authority(&self) -> &str {
        self.url
            .split_once(SCHEME_SEPARATOR)
            .map(|(_, authority)| authority)
            .unwrap_or(&self.url)
    }

    /// The tunnel's WebSocket address, over TLS whenever the upstream itself is.
    pub fn tunnel_url(&self) -> String {
        let scheme = if self.is_secure() {
            SECURE_WEBSOCKET_SCHEME
        } else {
            PLAIN_WEBSOCKET_SCHEME
        };
        format!("{scheme}{}{TUNNEL_PATH}", self.authority())
    }

    pub fn enroll_url(&self) -> String {
        format!("{}{ENROLL_PATH}", self.url)
    }

    fn is_secure(&self) -> bool {
        self.url.starts_with(HTTPS_SCHEME)
    }
}

/// Reads the stored upstream, reporting a stored value that no longer parses rather than hiding it.
pub fn load(database: &Database) -> Result<Option<UpstreamSettings>, String> {
    let Some(stored) = database
        .read_setting(SETTING_UPSTREAM)
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    serde_json::from_str(&stored)
        .map(Some)
        .map_err(|error| format!("{UNREADABLE_SETTINGS}{error}"))
}

pub fn store(database: &Database, settings: &UpstreamSettings) -> Result<(), DatabaseError> {
    // The struct is plain strings, so serialization cannot fail.
    let encoded =
        serde_json::to_string(settings).expect("the upstream settings are plain JSON-compatible");
    database.write_setting(SETTING_UPSTREAM, &encoded)
}

/// Forgets the upstream, credential included.
pub fn clear(database: &Database) -> Result<(), DatabaseError> {
    database.delete_setting(SETTING_UPSTREAM)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CREDENTIAL: &str = "tdc1.abcdefghijklmnopqrstuvwxyz.c2VjcmV0LXZhbHVlLWZvci10ZXN0aW5n";

    fn settings(url: &str) -> UpstreamSettings {
        UpstreamSettings::build(url, CREDENTIAL.into(), None).expect("the settings should build")
    }

    #[test]
    fn an_address_is_normalized_and_turned_into_the_two_urls_the_link_needs() {
        let settings = settings("https://relay-a.example.com/");

        assert_eq!(settings.url, "https://relay-a.example.com");
        assert_eq!(settings.authority(), "relay-a.example.com");
        assert_eq!(settings.tunnel_url(), "wss://relay-a.example.com/tunnel");
        assert_eq!(
            settings.enroll_url(),
            "https://relay-a.example.com/api/enroll"
        );
    }

    #[test]
    fn a_plain_http_upstream_is_dialled_over_ws() {
        assert_eq!(
            settings("http://127.0.0.1:8443").tunnel_url(),
            "ws://127.0.0.1:8443/tunnel"
        );
    }

    #[test]
    fn an_address_that_is_not_an_origin_is_refused() {
        assert!(UpstreamSettings::build("relay-a.example.com", CREDENTIAL.into(), None).is_err());
        assert!(UpstreamSettings::build(
            "https://relay-a.example.com/console",
            CREDENTIAL.into(),
            None
        )
        .is_err());
    }

    #[test]
    fn a_credential_that_is_not_a_device_credential_is_refused() {
        let error = UpstreamSettings::build("https://relay-a.example.com", "nonsense".into(), None)
            .expect_err("a malformed credential should be refused");

        assert_eq!(error, INVALID_CREDENTIAL);
    }

    #[test]
    fn the_settings_round_trip_through_the_database_and_can_be_forgotten() {
        let database = Database::open_in_memory().expect("the database should open");
        let stored = UpstreamSettings::build(
            "https://relay-a.example.com",
            CREDENTIAL.into(),
            Some("a1b2".into()),
        )
        .expect("the settings should build");

        assert_eq!(load(&database).expect("a read"), None);
        store(&database, &stored).expect("the settings should store");
        assert_eq!(load(&database).expect("a read"), Some(stored));
        clear(&database).expect("the settings should clear");
        assert_eq!(load(&database).expect("a read"), None);
    }

    #[test]
    fn the_stored_json_is_camel_case_and_omits_an_absent_fingerprint() {
        let plain =
            serde_json::to_string(&settings("https://relay-a.example.com")).expect("it encodes");
        let pinned = serde_json::to_string(
            &UpstreamSettings::build(
                "https://relay-a.example.com",
                CREDENTIAL.into(),
                Some("a1b2".into()),
            )
            .expect("the settings should build"),
        )
        .expect("it encodes");

        assert!(plain.contains("\"url\":\"https://relay-a.example.com\""));
        assert!(!plain.contains("certificateFingerprint"));
        assert!(pinned.contains("\"certificateFingerprint\":\"a1b2\""));
    }

    #[test]
    fn stored_settings_that_no_longer_parse_are_reported_rather_than_ignored() {
        let database = Database::open_in_memory().expect("the database should open");
        database
            .write_setting(SETTING_UPSTREAM, "{ not json")
            .expect("the value should store");

        assert!(load(&database)
            .expect_err("a broken value should be reported")
            .starts_with(UNREADABLE_SETTINGS));
    }

    #[test]
    fn the_debug_output_never_carries_the_credential() {
        let rendered = format!("{:?}", settings("https://relay-a.example.com"));

        assert!(!rendered.contains("tdc1."));
        assert!(rendered.contains("relay-a.example.com"));
    }
}
