//! The console's relay page. Cascading upstream is the next stage, so only the downstream half is
//! answered here; the upstream endpoints exist and say so rather than 404ing.

use axum::extract::State;
use axum::Json;
use serde::Serialize;

use super::error::{ApiError, ApiResult};
use super::AdminUser;
use crate::state::SharedState;

/// Answered by both upstream endpoints until cascading lands.
const UPSTREAM_NOT_YET: &str = "上游中继将在下一阶段支持。";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayOverview {
    /// Always `null` in this stage; the field exists so the console does not have to change shape
    /// when cascading arrives.
    upstream: Option<UpstreamView>,
    downstreams: Vec<DownstreamView>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamView {
    url: String,
    connected: bool,
    chain: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownstreamView {
    device_id: String,
    name: String,
    online: bool,
    device_count: usize,
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
        upstream: None,
        downstreams,
    }))
}

pub async fn set_upstream(_admin: AdminUser) -> ApiError {
    ApiError::not_implemented(UPSTREAM_NOT_YET)
}

pub async fn clear_upstream(_admin: AdminUser) -> ApiError {
    ApiError::not_implemented(UPSTREAM_NOT_YET)
}
