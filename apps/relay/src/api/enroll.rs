//! `POST /api/enroll`: the one endpoint a desktop app calls before it has a credential.
//!
//! Both ways in — an administrator's one-time code and a user's own account password — end in the
//! same device credential. They differ only in who created the device record and who owns it.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use termexo_relay_protocol::credential::DeviceCredential;
use termexo_relay_protocol::frames::DeviceKind;
use termexo_relay_protocol::tunnel::{EnrollRequest, EnrollResponse};

use super::error::{ApiError, ApiResult};
use super::{require_text, ApiJson, Client};
use crate::audit::{self, action, target, ActorKind, AuditEntry};
use crate::auth::code::{hash_code, normalize_code};
use crate::auth::password::verify_password;
use crate::auth::LOCKED_OUT_MESSAGE;
use crate::db::{now_millis, NewDevice};
use crate::state::SharedState;

/// Longest device name the console and the panel render without wrapping awkwardly.
const MAX_DEVICE_NAME_LENGTH: usize = 64;
const DEVICE_NAME_FIELD: &str = "设备名称";

/// The same sentence for every way a code can fail, so trying codes tells an attacker nothing
/// beyond "not this one".
const INVALID_CODE: &str = "接入码无效、已过期或已被使用。";
const INVALID_ACCOUNT: &str = "用户名或密码不正确。";

pub async fn enroll(
    State(state): State<SharedState>,
    Client(client): Client,
    ApiJson(request): ApiJson<EnrollRequest>,
) -> ApiResult<(StatusCode, Json<EnrollResponse>)> {
    if state.lockout.is_locked(client.ip) {
        return Err(ApiError::unauthorized(LOCKED_OUT_MESSAGE));
    }

    let outcome = match request {
        EnrollRequest::Code { code, name } => enroll_with_code(&state, &code, &name),
        EnrollRequest::Password {
            username,
            password,
            name,
        } => enroll_with_password(&state, &username, &password, &name),
    };

    match outcome {
        Ok(response) => {
            state.lockout.clear(client.ip);
            audit::record(
                &state.database,
                AuditEntry::new(ActorKind::Device, action::ENROLL)
                    .actor(&response.device_id)
                    .target(target::DEVICE, &response.device_id)
                    .from_ip(client.ip),
            );
            Ok((StatusCode::CREATED, Json(response)))
        }
        Err(error) => {
            // Only a refused credential counts towards the lockout; a malformed name is the
            // operator's typo, not an attempt to guess anything.
            if error.status() == StatusCode::UNAUTHORIZED {
                state.lockout.record_failure(client.ip);
                audit::record(
                    &state.database,
                    AuditEntry::new(ActorKind::Device, action::ENROLL_FAILED).from_ip(client.ip),
                );
            }
            Err(error)
        }
    }
}

fn enroll_with_code(state: &SharedState, code: &str, name: &str) -> ApiResult<EnrollResponse> {
    let name = require_text(name, DEVICE_NAME_FIELD, MAX_DEVICE_NAME_LENGTH)?;
    let canonical = normalize_code(code).ok_or_else(|| ApiError::unauthorized(INVALID_CODE))?;
    let enrollment = state
        .database
        .find_enrollment_by_hash(&hash_code(&canonical))?
        .filter(|enrollment| enrollment.is_redeemable(now_millis()))
        .ok_or_else(|| ApiError::unauthorized(INVALID_CODE))?;

    let credential = issue_device(
        state,
        enrollment.kind,
        enrollment.owner_user_id.as_deref(),
        &name,
    )?;
    // Burning the code last and checking the result is what makes it one-time even if two devices
    // redeem it at the same moment: the loser's device row is revoked rather than left usable.
    if !state
        .database
        .mark_enrollment_used(&enrollment.id, credential.device_id.as_str())?
    {
        state
            .database
            .revoke_device(credential.device_id.as_str())?;
        return Err(ApiError::unauthorized(INVALID_CODE));
    }
    Ok(response_for(state, &credential))
}

fn enroll_with_password(
    state: &SharedState,
    username: &str,
    password: &str,
    name: &str,
) -> ApiResult<EnrollResponse> {
    let name = require_text(name, DEVICE_NAME_FIELD, MAX_DEVICE_NAME_LENGTH)?;
    let user = state
        .database
        .find_user_by_username(username.trim())?
        .filter(|user| !user.disabled && verify_password(password, &user.password_hash))
        .ok_or_else(|| ApiError::unauthorized(INVALID_ACCOUNT))?;

    let credential = issue_device(state, DeviceKind::Desktop, Some(&user.id), &name)?;
    Ok(response_for(state, &credential))
}

/// Creates the device row and returns the credential, which exists in the clear only here.
fn issue_device(
    state: &SharedState,
    kind: DeviceKind,
    owner_user_id: Option<&str>,
    name: &str,
) -> ApiResult<DeviceCredential> {
    let credential =
        DeviceCredential::generate().map_err(|error| ApiError::internal("credential", error))?;
    state.database.create_device(NewDevice {
        id: credential.device_id.as_str(),
        kind,
        name,
        owner_user_id,
        secret_hash: &credential.secret_hash(),
        note: None,
    })?;
    Ok(credential)
}

fn response_for(state: &SharedState, credential: &DeviceCredential) -> EnrollResponse {
    EnrollResponse {
        credential: credential.to_string(),
        device_id: credential.device_id.to_string(),
        relay_id: state.relay_id.clone(),
    }
}
