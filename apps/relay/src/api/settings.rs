//! `/api/health` and the console's settings page.

use axum::extract::State;
use axum::Json;
use serde::Serialize;
use termexo_relay_protocol::frames::PROTOCOL_VERSION;

use super::error::ApiResult;
use super::AdminUser;
use crate::state::{SharedState, RELAY_VERSION};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    version: &'static str,
    relay_id: String,
    protocol: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsResponse {
    relay_id: String,
    public_url: String,
    version: &'static str,
}

/// Unauthenticated on purpose: a desktop app needs it to tell a reachable relay from an unrelated
/// service on the same host, and it reveals nothing a tunnel handshake would not.
pub async fn health(State(state): State<SharedState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        version: RELAY_VERSION,
        relay_id: state.relay_id.clone(),
        protocol: PROTOCOL_VERSION,
    })
}

pub async fn settings(
    State(state): State<SharedState>,
    _admin: AdminUser,
) -> ApiResult<Json<SettingsResponse>> {
    Ok(Json(SettingsResponse {
        relay_id: state.relay_id.clone(),
        public_url: state.public_url().origin().to_string(),
        version: RELAY_VERSION,
    }))
}
