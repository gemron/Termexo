//! The console's relay page: the link this relay holds upward, and the relays that joined it.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use super::error::{ApiError, ApiResult};
use super::{no_content, require_text, AdminUser, ApiJson};
use crate::state::SharedState;
use crate::upstream::{self, UpstreamView};

/// Longest address and code the form accepts, so a stray paste is refused before it is dialled.
const MAX_URL_LENGTH: usize = 256;
const MAX_CODE_LENGTH: usize = 128;
const URL_FIELD: &str = "上游中继地址";
const CODE_FIELD: &str = "接入码";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayOverview {
    /// `null` while no upstream is configured, which is what puts the console's join form on
    /// screen instead of a status block.
    upstream: Option<UpstreamView>,
    downstreams: Vec<DownstreamView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownstreamView {
    device_id: String,
    name: String,
    online: bool,
    device_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamEnvelope {
    upstream: UpstreamView,
}

#[derive(Debug, Deserialize)]
pub struct UpstreamRequest {
    url: String,
    code: String,
}

pub async fn list(
    State(state): State<SharedState>,
    _admin: AdminUser,
) -> ApiResult<Json<RelayOverview>> {
    let mut downstreams: Vec<DownstreamView> = state
        .registry
        .downstream_links()
        .into_iter()
        .map(|link| DownstreamView {
            device_id: link.device_id,
            name: link.name,
            // The registry only holds live links, so anything listed here is connected by
            // definition; the field stays for the console's table.
            online: true,
            device_count: link.device_count,
        })
        .collect();
    downstreams.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(Json(RelayOverview {
        upstream: state.upstream.view(),
        downstreams,
    }))
}

/// Trades the upstream's enrollment code for a credential and brings the link up.
///
/// Nothing is stored until the exchange succeeded, so a refused code leaves the relay exactly as
/// it was.
pub async fn set_upstream(
    State(state): State<SharedState>,
    admin: AdminUser,
    ApiJson(request): ApiJson<UpstreamRequest>,
) -> ApiResult<(StatusCode, Json<UpstreamEnvelope>)> {
    let url = require_text(&request.url, URL_FIELD, MAX_URL_LENGTH)?;
    let code = require_text(&request.code, CODE_FIELD, MAX_CODE_LENGTH)?;

    let upstream = upstream::connect(&state, &url, &code, &admin.0.user.id)
        .await
        .map_err(ApiError::bad_request)?;
    Ok((StatusCode::CREATED, Json(UpstreamEnvelope { upstream })))
}

pub async fn clear_upstream(
    State(state): State<SharedState>,
    admin: AdminUser,
) -> ApiResult<StatusCode> {
    upstream::disconnect(&state, &admin.0.user.id)
        .await
        .map_err(ApiError::bad_request)?;
    Ok(no_content())
}
