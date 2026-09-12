//! Constants and small types both ends of a tunnel have to agree on: the relay's paths, the
//! timings and close codes of the control plane, the forwarding headers the reverse proxy sets,
//! and the enrollment exchange that hands a device its credential.

mod backoff;
mod stream;

use std::fmt;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::REDACTED_PLACEHOLDER;

pub use backoff::{Backoff, INITIAL_RECONNECT_DELAY, MAX_RECONNECT_DELAY};
pub use stream::ChannelByteStream;

/// Where a device opens its outbound tunnel.
pub const TUNNEL_PATH: &str = "/tunnel";
/// Where a device trades an enrollment code or an account password for a device credential.
pub const ENROLL_PATH: &str = "/api/enroll";
/// Unauthenticated, so a device can tell a reachable relay from an unrelated service on the host.
pub const HEALTH_PATH: &str = "/api/health";
/// Prefix of the public address of one device: `/d/<deviceId>/`.
pub const DEVICE_PATH_PREFIX: &str = "/d/";

/// A tunnel that never sends `hello` must not hold a slot open.
pub const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
/// Both ends ping on this interval, so three missed pings end the tunnel.
pub const PING_INTERVAL: Duration = Duration::from_secs(20);
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// WebSocket close codes. 1001 is the standard "going away"; the 44xx values are application
/// specific and mirror the ones the workbench's own `/ws` uses.
pub const CLOSE_GOING_AWAY: u16 = 1001;
pub const CLOSE_UNAUTHORIZED: u16 = 4401;
/// The device was revoked: the desktop app stops reconnecting and forgets its credential.
pub const CLOSE_REVOKED: u16 = 4403;

/// The base path the entry relay serves the device under, so the tunnel router can rewrite
/// `<base href>` and the browser resolves assets and the WebSocket against the right prefix.
pub const HEADER_TERMEXO_BASE: &str = "x-termexo-base";
/// The browser's own address. The tunnel router counts failures against this rather than against
/// the relay's egress address, which would lock every remote browser out at once.
pub const HEADER_FORWARDED_FOR: &str = "x-forwarded-for";
pub const HEADER_FORWARDED_PROTO: &str = "x-forwarded-proto";
pub const HEADER_FORWARDED_HOST: &str = "x-forwarded-host";

/// The body of `POST /api/enroll`. Both ways of joining a relay end in the same device credential;
/// they differ only in who creates the device record and who owns it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "method",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum EnrollRequest {
    /// An administrator issued a one-time code out of band.
    Code { code: String, name: String },
    /// A user enrolls a device of their own. The password appears in this one request and is never
    /// stored by the desktop app.
    Password {
        username: String,
        password: String,
        name: String,
    },
}

/// Written by hand so an enrollment that is logged on a failure path cannot carry the code or the
/// password into the log.
impl fmt::Debug for EnrollRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Code { name, .. } => formatter
                .debug_struct("EnrollRequest::Code")
                .field("code", &REDACTED_PLACEHOLDER)
                .field("name", name)
                .finish(),
            Self::Password { username, name, .. } => formatter
                .debug_struct("EnrollRequest::Password")
                .field("username", username)
                .field("password", &REDACTED_PLACEHOLDER)
                .field("name", name)
                .finish(),
        }
    }
}

/// The answer to an accepted enrollment. `credential` is the only time the secret is ever sent.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    pub credential: String,
    pub device_id: String,
    pub relay_id: String,
}

/// Redacts `credential` for the same reason [`EnrollRequest`] redacts its secrets.
impl fmt::Debug for EnrollResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("EnrollResponse")
            .field("credential", &REDACTED_PLACEHOLDER)
            .field("device_id", &self.device_id)
            .field("relay_id", &self.relay_id)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_enrollment_by_code_encodes_with_a_method_tag() {
        let request = EnrollRequest::Code {
            code: "ABCD-EFGH-IJKL".into(),
            name: "书房台式机".into(),
        };

        assert_eq!(
            serde_json::to_string(&request).expect("the request should serialize"),
            r#"{"method":"code","code":"ABCD-EFGH-IJKL","name":"书房台式机"}"#
        );
    }

    #[test]
    fn an_enrollment_by_password_encodes_with_a_method_tag() {
        let request = EnrollRequest::Password {
            username: "zhang".into(),
            password: "hunter2".into(),
            name: "办公室电脑".into(),
        };

        assert_eq!(
            serde_json::to_string(&request).expect("the request should serialize"),
            r#"{"method":"password","username":"zhang","password":"hunter2","name":"办公室电脑"}"#
        );
    }

    #[test]
    fn an_enrollment_request_survives_a_round_trip() {
        let request = EnrollRequest::Code {
            code: "ABCD".into(),
            name: "pc".into(),
        };
        let encoded = serde_json::to_string(&request).expect("the request should serialize");

        assert_eq!(
            serde_json::from_str::<EnrollRequest>(&encoded).expect("it should parse"),
            request
        );
    }

    #[test]
    fn the_debug_output_of_a_request_never_carries_the_secret() {
        let code = EnrollRequest::Code {
            code: "ABCD-EFGH-IJKL".into(),
            name: "pc".into(),
        };
        let password = EnrollRequest::Password {
            username: "zhang".into(),
            password: "hunter2".into(),
            name: "pc".into(),
        };

        assert!(!format!("{code:?}").contains("ABCD-EFGH-IJKL"));
        assert!(!format!("{password:?}").contains("hunter2"));
        assert!(format!("{password:?}").contains("zhang"));
    }

    #[test]
    fn the_response_encodes_in_camel_case_and_hides_the_credential_from_debug() {
        let response = EnrollResponse {
            credential: "tdc1.abcdefghijklmnopqrstuvwxyz.secret".into(),
            device_id: "abcdefghijklmnopqrstuvwxyz".into(),
            relay_id: "relay-a".into(),
        };

        assert_eq!(
            serde_json::to_string(&response).expect("the response should serialize"),
            concat!(
                r#"{"credential":"tdc1.abcdefghijklmnopqrstuvwxyz.secret","#,
                r#""deviceId":"abcdefghijklmnopqrstuvwxyz","relayId":"relay-a"}"#
            )
        );
        assert!(!format!("{response:?}").contains("secret"));
    }
}
