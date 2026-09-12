//! Device listing and management, for administrators and for owners of their own devices.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use super::error::{ApiError, ApiResult};
use super::views::{DeviceView, ViewContext};
use super::{no_content, require_text, AdminUser, ApiJson, Client, SessionUser};
use crate::audit::{self, action, target, AuditEntry};
use crate::db::{DeviceRecord, DeviceUpdate};
use crate::state::SharedState;
use crate::tunnel;

const MAX_DEVICE_NAME_LENGTH: usize = 64;
const MAX_NOTE_LENGTH: usize = 200;
const DEVICE_NAME_FIELD: &str = "设备名称";
const NOTE_FIELD: &str = "备注";

const UNKNOWN_DEVICE: &str = "设备不存在。";
const NOT_YOUR_DEVICE: &str = "只能管理自己名下的设备。";
const NOTHING_TO_UPDATE: &str = "没有需要修改的字段。";

/// Told to the device when an operator revokes it, and shown in the desktop panel.
const REVOKED_REASON: &str = "接入已被中继撤销。";
const DISCONNECTED_REASON: &str = "中继管理员断开了这条隧道。";

#[derive(Debug, Serialize)]
pub struct DeviceListEnvelope {
    devices: Vec<DeviceView>,
}

#[derive(Debug, Serialize)]
pub struct DeviceEnvelope {
    device: DeviceView,
}

#[derive(Debug, Deserialize)]
pub struct DeviceUpdateRequest {
    name: Option<String>,
    note: Option<String>,
}

pub async fn list_all(
    State(state): State<SharedState>,
    _admin: AdminUser,
) -> ApiResult<Json<DeviceListEnvelope>> {
    let records = state.database.list_devices()?;
    let context = ViewContext::build(&state)?;
    let mut devices: Vec<DeviceView> = records
        .iter()
        .map(|record| context.device(record))
        .collect();
    // Devices a downstream relay announced have no row here, and the console still has to show them.
    devices.extend(context.announced_only(&records));
    Ok(Json(DeviceListEnvelope { devices }))
}

pub async fn list_own(
    State(state): State<SharedState>,
    session: SessionUser,
) -> ApiResult<Json<DeviceListEnvelope>> {
    let records = state.database.list_devices_owned_by(&session.user.id)?;
    let context = ViewContext::build(&state)?;
    Ok(Json(DeviceListEnvelope {
        devices: records
            .iter()
            .map(|record| context.device(record))
            .collect(),
    }))
}

pub async fn update_any(
    State(state): State<SharedState>,
    admin: AdminUser,
    Client(client): Client,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<DeviceUpdateRequest>,
) -> ApiResult<Json<DeviceEnvelope>> {
    let device = find_device(&state, &id)?;
    apply_update(&state, &device, request, &admin.0.user.id, client.ip)
}

pub async fn update_own(
    State(state): State<SharedState>,
    session: SessionUser,
    Client(client): Client,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<DeviceUpdateRequest>,
) -> ApiResult<Json<DeviceEnvelope>> {
    let device = find_own_device(&state, &session, &id)?;
    // A note is an administrator's annotation, so an owner may only rename their device.
    apply_update(
        &state,
        &device,
        DeviceUpdateRequest {
            name: request.name,
            note: None,
        },
        &session.user.id,
        client.ip,
    )
}

pub async fn revoke_any(
    State(state): State<SharedState>,
    admin: AdminUser,
    Client(client): Client,
    Path(id): Path<String>,
) -> ApiResult<Json<DeviceEnvelope>> {
    let device = find_device(&state, &id)?;
    revoke(&state, &device.id, &admin.0.user.id, client.ip)?;
    envelope(&state, &device.id)
}

pub async fn revoke_own(
    State(state): State<SharedState>,
    session: SessionUser,
    Client(client): Client,
    Path(id): Path<String>,
) -> ApiResult<Json<DeviceEnvelope>> {
    let device = find_own_device(&state, &session, &id)?;
    revoke(&state, &device.id, &session.user.id, client.ip)?;
    envelope(&state, &device.id)
}

pub async fn disconnect_any(
    State(state): State<SharedState>,
    admin: AdminUser,
    Client(client): Client,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let device = find_device(&state, &id)?;
    if let Some(route) = state.registry.route(&device.id) {
        tunnel::disconnect_tunnel(route.link(), DISCONNECTED_REASON);
    }
    audit::record(
        &state.database,
        AuditEntry::by_user(&admin.0.user.id, action::DEVICE_DISCONNECTED)
            .target(target::DEVICE, &device.id)
            .from_ip(client.ip),
    );
    Ok(no_content())
}

/// Revokes a device and, if it is connected, tells it why before closing its tunnel.
///
/// Shared with the user endpoints so disabling an account and revoking one device take exactly the
/// same steps.
pub(super) fn revoke(
    state: &SharedState,
    device_id: &str,
    actor_id: &str,
    ip: std::net::IpAddr,
) -> ApiResult<()> {
    let changed = state.database.revoke_device(device_id)?;
    if let Some(route) = state.registry.route(device_id) {
        tunnel::revoke_tunnel(route.link(), REVOKED_REASON);
    }
    if changed {
        audit::record(
            &state.database,
            AuditEntry::by_user(actor_id, action::DEVICE_REVOKED)
                .target(target::DEVICE, device_id)
                .from_ip(ip),
        );
    }
    Ok(())
}

fn apply_update(
    state: &SharedState,
    device: &DeviceRecord,
    request: DeviceUpdateRequest,
    actor_id: &str,
    ip: std::net::IpAddr,
) -> ApiResult<Json<DeviceEnvelope>> {
    let update = DeviceUpdate {
        name: request
            .name
            .map(|name| require_text(&name, DEVICE_NAME_FIELD, MAX_DEVICE_NAME_LENGTH))
            .transpose()?,
        // An empty note is how the console clears one, so it is not put through `require_text`.
        note: request.note.map(|note| bounded_note(&note)).transpose()?,
    };
    if update.is_empty() {
        return Err(ApiError::bad_request(NOTHING_TO_UPDATE));
    }
    state.database.update_device(&device.id, &update)?;
    audit::record(
        &state.database,
        AuditEntry::by_user(actor_id, action::DEVICE_UPDATED)
            .target(target::DEVICE, &device.id)
            .from_ip(ip),
    );
    envelope(state, &device.id)
}

fn bounded_note(note: &str) -> ApiResult<String> {
    let trimmed = note.trim();
    if trimmed.chars().count() > MAX_NOTE_LENGTH {
        return Err(ApiError::bad_request(format!(
            "{NOTE_FIELD}不能超过 {MAX_NOTE_LENGTH} 个字符。"
        )));
    }
    Ok(trimmed.to_string())
}

fn envelope(state: &SharedState, device_id: &str) -> ApiResult<Json<DeviceEnvelope>> {
    let device = find_device(state, device_id)?;
    let context = ViewContext::build(state)?;
    Ok(Json(DeviceEnvelope {
        device: context.device(&device),
    }))
}

fn find_device(state: &SharedState, device_id: &str) -> ApiResult<DeviceRecord> {
    state
        .database
        .find_device(device_id)?
        .ok_or_else(|| ApiError::not_found(UNKNOWN_DEVICE))
}

/// Looks a device up on behalf of its owner.
///
/// A device that exists but belongs to somebody else answers the same as one that does not exist
/// would, so the endpoint cannot be used to enumerate other people's devices.
fn find_own_device(
    state: &SharedState,
    session: &SessionUser,
    device_id: &str,
) -> ApiResult<DeviceRecord> {
    let device = find_device(state, device_id)?;
    if device.owner_user_id.as_deref() != Some(session.user.id.as_str()) {
        return Err(ApiError::forbidden(NOT_YOUR_DEVICE));
    }
    Ok(device)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_note_may_be_cleared_but_not_be_unbounded() {
        assert_eq!(bounded_note("  留言  ").expect("it should pass"), "留言");
        assert_eq!(bounded_note("   ").expect("an empty note clears it"), "");
        assert!(bounded_note(&"字".repeat(MAX_NOTE_LENGTH + 1)).is_err());
    }
}
