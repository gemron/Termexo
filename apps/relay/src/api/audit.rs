//! Reading the audit trail.

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};

use super::error::ApiResult;
use super::views::AuditView;
use super::{AdminUser, ApiQuery};
use crate::db::{AuditQuery, MAX_AUDIT_PAGE};
use crate::state::SharedState;

/// Page size when the console does not ask for one.
const DEFAULT_AUDIT_PAGE: u32 = 100;

#[derive(Debug, Serialize)]
pub struct AuditEnvelope {
    events: Vec<AuditView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditParameters {
    limit: Option<u32>,
    /// Only events older than this id, for paging backwards in time.
    before: Option<i64>,
    target_id: Option<String>,
}

pub async fn list(
    State(state): State<SharedState>,
    _admin: AdminUser,
    ApiQuery(parameters): ApiQuery<AuditParameters>,
) -> ApiResult<Json<AuditEnvelope>> {
    let events = state.database.list_audit(&AuditQuery {
        limit: parameters
            .limit
            .unwrap_or(DEFAULT_AUDIT_PAGE)
            .min(MAX_AUDIT_PAGE),
        before_id: parameters.before,
        target_id: parameters
            .target_id
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty()),
    })?;
    Ok(Json(AuditEnvelope {
        events: events.into_iter().map(AuditView::from).collect(),
    }))
}
