//! Administration of console accounts.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use super::error::{ApiError, ApiResult};
use super::sessions::validated_password;
use super::views::{live_device_count, UserView, ViewContext};
use super::{devices, no_content, require_text, AdminUser, ApiJson, Client};
use crate::audit::{self, action, target, AuditEntry};
use crate::auth::password::hash_password;
use crate::db::{UserRecord, UserRole, UserUpdate};
use crate::state::SharedState;

const MAX_USERNAME_LENGTH: usize = 64;
const USERNAME_FIELD: &str = "用户名";

const UNKNOWN_USER: &str = "用户不存在。";
const NOTHING_TO_UPDATE: &str = "没有需要修改的字段。";
const CANNOT_DELETE_SELF: &str = "不能删除当前登录的账号。";
const USERNAME_HAS_SPACES: &str = "用户名不能包含空格。";

#[derive(Debug, Serialize)]
pub struct UserListEnvelope {
    users: Vec<UserView>,
}

#[derive(Debug, Serialize)]
pub struct UserEnvelope {
    user: UserView,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    username: String,
    password: String,
    role: UserRole,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    disabled: Option<bool>,
    role: Option<UserRole>,
    password: Option<String>,
}

pub async fn list(
    State(state): State<SharedState>,
    _admin: AdminUser,
) -> ApiResult<Json<UserListEnvelope>> {
    let users = state.database.list_users()?;
    let context = ViewContext::build(&state)?;
    let mut views = Vec::with_capacity(users.len());
    for user in &users {
        views.push(context.user(user, count_devices(&state, &user.id)?));
    }
    Ok(Json(UserListEnvelope { users: views }))
}

pub async fn create(
    State(state): State<SharedState>,
    admin: AdminUser,
    Client(client): Client,
    ApiJson(request): ApiJson<CreateUserRequest>,
) -> ApiResult<(StatusCode, Json<UserEnvelope>)> {
    let username = validated_username(&request.username)?;
    let hash =
        hash_password(&validated_password(&request.password)?).map_err(ApiError::bad_request)?;
    let user = state.database.create_user(&username, &hash, request.role)?;
    audit::record(
        &state.database,
        AuditEntry::by_user(&admin.0.user.id, action::USER_CREATED)
            .target(target::USER, &user.id)
            .from_ip(client.ip)
            .detail("username", username.as_str())
            .detail("role", request.role.as_str()),
    );
    Ok((StatusCode::CREATED, Json(envelope(&state, &user)?)))
}

pub async fn update(
    State(state): State<SharedState>,
    admin: AdminUser,
    Client(client): Client,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<UpdateUserRequest>,
) -> ApiResult<Json<UserEnvelope>> {
    let user = find_user(&state, &id)?;
    let update = UserUpdate {
        disabled: request.disabled,
        role: request.role,
        password_hash: request
            .password
            .map(|password| {
                validated_password(&password)
                    .and_then(|password| hash_password(&password).map_err(ApiError::bad_request))
            })
            .transpose()?,
    };
    if update.is_empty() {
        return Err(ApiError::bad_request(NOTHING_TO_UPDATE));
    }
    let changed = describe_changes(&update);
    state.database.update_user(&user.id, &update)?;

    // A password change or a disable both have to end whatever is already signed in as this account.
    if update.password_hash.is_some() || update.disabled == Some(true) {
        state.database.delete_sessions_of_user(&user.id)?;
    }
    if update.disabled == Some(true) {
        revoke_devices_of(&state, &user, &admin.0.user.id, client.ip)?;
    }
    audit::record(
        &state.database,
        AuditEntry::by_user(&admin.0.user.id, action::USER_UPDATED)
            .target(target::USER, &user.id)
            .from_ip(client.ip)
            .detail("changed", changed),
    );
    Ok(Json(envelope(&state, &find_user(&state, &id)?)?))
}

pub async fn delete(
    State(state): State<SharedState>,
    admin: AdminUser,
    Client(client): Client,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    if id == admin.0.user.id {
        return Err(ApiError::bad_request(CANNOT_DELETE_SELF));
    }
    let user = find_user(&state, &id)?;
    revoke_devices_of(&state, &user, &admin.0.user.id, client.ip)?;
    state.database.disown_devices_of(&user.id)?;
    state.database.delete_sessions_of_user(&user.id)?;
    state.database.delete_user(&user.id)?;
    audit::record(
        &state.database,
        AuditEntry::by_user(&admin.0.user.id, action::USER_DELETED)
            .target(target::USER, &user.id)
            .from_ip(client.ip)
            .detail("username", user.username.as_str()),
    );
    Ok(no_content())
}

/// Revokes every device an account owns and closes the tunnels they hold.
fn revoke_devices_of(
    state: &SharedState,
    user: &UserRecord,
    actor_id: &str,
    ip: std::net::IpAddr,
) -> ApiResult<()> {
    for device in state.database.list_devices_owned_by(&user.id)? {
        devices::revoke(state, &device.id, actor_id, ip)?;
    }
    Ok(())
}

/// Names the fields a patch touched, so the audit trail says what changed without saying to what.
fn describe_changes(update: &UserUpdate) -> String {
    let mut changed = Vec::new();
    if update.disabled.is_some() {
        changed.push("disabled");
    }
    if update.role.is_some() {
        changed.push("role");
    }
    if update.password_hash.is_some() {
        changed.push("password");
    }
    changed.join(",")
}

fn validated_username(username: &str) -> ApiResult<String> {
    let username = require_text(username, USERNAME_FIELD, MAX_USERNAME_LENGTH)?;
    if username.chars().any(char::is_whitespace) {
        return Err(ApiError::bad_request(USERNAME_HAS_SPACES));
    }
    Ok(username)
}

fn count_devices(state: &SharedState, user_id: &str) -> ApiResult<usize> {
    Ok(live_device_count(
        &state.database.list_devices_owned_by(user_id)?,
    ))
}

fn envelope(state: &SharedState, user: &UserRecord) -> ApiResult<UserEnvelope> {
    let context = ViewContext::build(state)?;
    Ok(UserEnvelope {
        user: context.user(user, count_devices(state, &user.id)?),
    })
}

fn find_user(state: &SharedState, id: &str) -> ApiResult<UserRecord> {
    state
        .database
        .find_user(id)?
        .ok_or_else(|| ApiError::not_found(UNKNOWN_USER))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_username_is_trimmed_and_must_not_contain_spaces() {
        assert_eq!(
            validated_username("  alice  ").expect("it should pass"),
            "alice"
        );
        assert!(validated_username("al ice").is_err());
        assert!(validated_username("  ").is_err());
    }

    #[test]
    fn the_audit_detail_names_the_fields_without_their_values() {
        let described = describe_changes(&UserUpdate {
            disabled: Some(true),
            role: None,
            password_hash: Some("$argon2id$secret".into()),
        });

        assert_eq!(described, "disabled,password");
        assert!(!described.contains("argon2"));
    }
}
