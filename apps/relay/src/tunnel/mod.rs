//! The `/tunnel` endpoint: credential check, WebSocket upgrade and the live session behind it.

mod handle;
mod session;

use std::net::SocketAddr;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderMap};
use axum::response::{IntoResponse, Response};
use termexo_relay_protocol::credential::{secret_matches_hash, DeviceCredential};
use termexo_relay_protocol::frames::ControlFrame;
use termexo_relay_protocol::tunnel::{CLOSE_GOING_AWAY, CLOSE_REVOKED};

pub use handle::{TunnelError, TunnelHandle, TunnelStream};

use crate::api::error::ApiError;
use crate::audit::{self, action, ActorKind, AuditEntry};
use crate::auth::LOCKED_OUT_MESSAGE;
use crate::db::DeviceRecord;
use crate::forwarded;
use crate::state::SharedState;

const BEARER_PREFIX: &str = "Bearer ";

/// Deliberately the same sentence whether the credential was malformed, unknown or revoked: telling
/// a caller which of the three it was would confirm that a device id exists.
const INVALID_CREDENTIAL_MESSAGE: &str = "设备凭据无效或已被撤销。";

/// Closes a tunnel because its device was revoked, telling the device why first so the desktop app
/// can forget its credential instead of retrying forever.
pub fn revoke_tunnel(handle: &TunnelHandle, reason: &str) {
    handle.send_frame(ControlFrame::Revoked {
        reason: reason.to_string(),
    });
    handle.close(CLOSE_REVOKED, reason);
}

/// Closes a tunnel the operator asked to drop. The device is expected to reconnect.
pub fn disconnect_tunnel(handle: &TunnelHandle, reason: &str) {
    handle.close(CLOSE_GOING_AWAY, reason);
}

/// `GET /tunnel`: authenticates the device, then hands the socket to the session.
pub async fn upgrade(
    State(state): State<SharedState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let client = forwarded::resolve(&state, &headers, peer);
    if state.lockout.is_locked(client.ip) {
        return ApiError::unauthorized(LOCKED_OUT_MESSAGE).into_response();
    }

    let device = match authenticate(&state, &headers) {
        Ok(device) => device,
        Err(reason) => {
            state.lockout.record_failure(client.ip);
            audit::record(
                &state.database,
                AuditEntry::new(ActorKind::Device, action::TUNNEL_REJECTED)
                    .from_ip(client.ip)
                    .detail("reason", reason),
            );
            return ApiError::unauthorized(INVALID_CREDENTIAL_MESSAGE).into_response();
        }
    };

    state.lockout.clear(client.ip);
    let client_ip = client.ip;
    upgrade.on_upgrade(move |socket| session::run(state, socket, device, client_ip))
}

/// Why a credential was refused. Recorded in the audit trail, never sent to the caller.
type RejectionReason = &'static str;

fn authenticate(state: &SharedState, headers: &HeaderMap) -> Result<DeviceRecord, RejectionReason> {
    let credential = bearer_credential(headers).ok_or("malformed-credential")?;
    let device = state
        .database
        .find_device(credential.device_id.as_str())
        .map_err(|error| {
            tracing::error!(%error, "查询设备记录失败");
            "lookup-failed"
        })?
        .ok_or("unknown-device")?;
    if device.is_revoked() {
        return Err("revoked");
    }
    if !secret_matches_hash(&credential.secret, &device.secret_hash) {
        return Err("secret-mismatch");
    }
    Ok(device)
}

fn bearer_credential(headers: &HeaderMap) -> Option<DeviceCredential> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix(BEARER_PREFIX)?;
    DeviceCredential::parse(token.trim()).ok()
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderValue;

    use super::*;

    #[test]
    fn a_bearer_credential_is_read_out_of_the_header() {
        let credential = DeviceCredential::generate().expect("a credential");
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {credential}")).expect("a header"),
        );

        let parsed = bearer_credential(&headers).expect("it should parse");

        assert_eq!(parsed.device_id, credential.device_id);
        assert_eq!(parsed.secret, credential.secret);
    }

    #[test]
    fn anything_but_a_well_formed_bearer_credential_is_refused() {
        let credential = DeviceCredential::generate().expect("a credential");
        for value in [
            String::new(),
            credential.to_string(),
            format!("Basic {credential}"),
            "Bearer not-a-credential".to_string(),
        ] {
            let mut headers = HeaderMap::new();
            if !value.is_empty() {
                headers.insert(
                    header::AUTHORIZATION,
                    HeaderValue::from_str(&value).expect("a header"),
                );
            }
            assert!(
                bearer_credential(&headers).is_none(),
                "{value} should not parse"
            );
        }
    }
}
