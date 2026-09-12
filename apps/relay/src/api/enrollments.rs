//! Issuing and cancelling one-time enrollment codes.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use termexo_relay_protocol::frames::DeviceKind;

use super::error::{ApiError, ApiResult};
use super::views::{EnrollmentView, ViewContext};
use super::{no_content, AdminUser, ApiJson, Client};
use crate::audit::{self, action, target, AuditEntry};
use crate::auth::code::{clamp_ttl_minutes, generate_code, hash_code};
use crate::db::{now_millis, NewEnrollment};
use crate::state::SharedState;

const MAX_NOTE_LENGTH: usize = 200;
const MILLIS_PER_MINUTE: i64 = 60 * 1000;

const UNKNOWN_ENROLLMENT: &str = "接入码不存在。";
const ALREADY_SETTLED: &str = "接入码已被使用或已作废。";
const UNKNOWN_OWNER: &str = "指定的归属用户不存在。";
const NOTE_TOO_LONG: &str = "备注不能超过 200 个字符。";

#[derive(Debug, Serialize)]
pub struct EnrollmentListEnvelope {
    enrollments: Vec<EnrollmentView>,
}

/// The one and only time the code itself leaves the relay.
#[derive(Debug, Serialize)]
pub struct IssuedEnrollment {
    enrollment: EnrollmentView,
    code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEnrollmentRequest {
    kind: DeviceKind,
    owner_user_id: Option<String>,
    ttl_minutes: Option<u32>,
    note: Option<String>,
}

pub async fn list(
    State(state): State<SharedState>,
    _admin: AdminUser,
) -> ApiResult<Json<EnrollmentListEnvelope>> {
    let records = state.database.list_enrollments()?;
    let context = ViewContext::build(&state)?;
    Ok(Json(EnrollmentListEnvelope {
        enrollments: records
            .iter()
            .map(|record| context.enrollment(record))
            .collect(),
    }))
}

pub async fn create(
    State(state): State<SharedState>,
    admin: AdminUser,
    Client(client): Client,
    ApiJson(request): ApiJson<CreateEnrollmentRequest>,
) -> ApiResult<(StatusCode, Json<IssuedEnrollment>)> {
    let owner = normalized_owner(&state, request.owner_user_id.as_deref())?;
    let note = bounded_note(request.note.as_deref())?;
    let ttl_minutes = clamp_ttl_minutes(request.ttl_minutes);

    let code = generate_code().map_err(ApiError::bad_request)?;
    let record = state.database.create_enrollment(NewEnrollment {
        code_hash: &hash_code(&code),
        kind: request.kind,
        owner_user_id: owner.as_deref(),
        created_by: &admin.0.user.id,
        note: note.as_deref(),
        expires_at: now_millis() + i64::from(ttl_minutes) * MILLIS_PER_MINUTE,
    })?;
    audit::record(
        &state.database,
        AuditEntry::by_user(&admin.0.user.id, action::ENROLLMENT_CREATED)
            .target(target::ENROLLMENT, &record.id)
            .from_ip(client.ip)
            .detail("kind", crate::db::device_kind_label(request.kind))
            .detail("ttlMinutes", ttl_minutes),
    );

    let context = ViewContext::build(&state)?;
    Ok((
        StatusCode::CREATED,
        Json(IssuedEnrollment {
            enrollment: context.enrollment(&record),
            code,
        }),
    ))
}

pub async fn cancel(
    State(state): State<SharedState>,
    admin: AdminUser,
    Client(client): Client,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let record = state
        .database
        .find_enrollment(&id)?
        .ok_or_else(|| ApiError::not_found(UNKNOWN_ENROLLMENT))?;
    if !state.database.cancel_enrollment(&record.id)? {
        return Err(ApiError::conflict(ALREADY_SETTLED));
    }
    audit::record(
        &state.database,
        AuditEntry::by_user(&admin.0.user.id, action::ENROLLMENT_CANCELLED)
            .target(target::ENROLLMENT, &record.id)
            .from_ip(client.ip),
    );
    Ok(no_content())
}

/// Turns an optional owner into one that is known to exist, so a code cannot be issued into a
/// dangling ownership.
fn normalized_owner(state: &SharedState, owner: Option<&str>) -> ApiResult<Option<String>> {
    let Some(owner) = owner.map(str::trim).filter(|owner| !owner.is_empty()) else {
        return Ok(None);
    };
    state
        .database
        .find_user(owner)?
        .map(|user| Some(user.id))
        .ok_or_else(|| ApiError::bad_request(UNKNOWN_OWNER))
}

fn bounded_note(note: Option<&str>) -> ApiResult<Option<String>> {
    let Some(note) = note.map(str::trim).filter(|note| !note.is_empty()) else {
        return Ok(None);
    };
    if note.chars().count() > MAX_NOTE_LENGTH {
        return Err(ApiError::bad_request(NOTE_TOO_LONG));
    }
    Ok(Some(note.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_or_blank_note_is_stored_as_nothing() {
        assert_eq!(bounded_note(None).expect("it should pass"), None);
        assert_eq!(bounded_note(Some("  ")).expect("it should pass"), None);
        assert_eq!(
            bounded_note(Some("  给同事  ")).expect("it should pass"),
            Some("给同事".to_string())
        );
        assert!(bounded_note(Some(&"字".repeat(MAX_NOTE_LENGTH + 1))).is_err());
    }
}
