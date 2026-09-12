//! Console login, logout and self-service password change.

use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};

use super::error::{ApiError, ApiResult};
use super::views::{live_device_count, UserView, ViewContext};
use super::{ApiJson, Client, SessionUser};
use crate::audit::{self, action, target, ActorKind, AuditEntry};
use crate::auth::password::{hash_password, verify_password, MIN_PASSWORD_LENGTH};
use crate::auth::session::{
    cleared_session_cookie, create_session, destroy_session, session_cookie,
};
use crate::auth::LOCKED_OUT_MESSAGE;
use crate::state::SharedState;

/// One sentence for a wrong name and a wrong password alike, so the endpoint cannot be used to find
/// out which accounts exist.
const INVALID_LOGIN: &str = "用户名或密码不正确。";
const WRONG_CURRENT_PASSWORD: &str = "当前密码不正确。";

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordChangeRequest {
    current_password: String,
    new_password: String,
}

#[derive(Debug, Serialize)]
pub struct UserEnvelope {
    user: UserView,
}

pub async fn login(
    State(state): State<SharedState>,
    Client(client): Client,
    ApiJson(request): ApiJson<LoginRequest>,
) -> ApiResult<Response> {
    if state.lockout.is_locked(client.ip) {
        return Err(ApiError::unauthorized(LOCKED_OUT_MESSAGE));
    }

    let candidate = state
        .database
        .find_user_by_username(request.username.trim())?;
    let Some(user) = candidate
        .filter(|user| !user.disabled && verify_password(&request.password, &user.password_hash))
    else {
        state.lockout.record_failure(client.ip);
        audit::record(
            &state.database,
            AuditEntry::new(ActorKind::User, action::LOGIN_FAILED)
                .from_ip(client.ip)
                .detail("username", request.username.trim()),
        );
        return Err(ApiError::unauthorized(INVALID_LOGIN));
    };

    state.lockout.clear(client.ip);
    state.database.record_user_login(&user.id)?;
    let token = create_session(&state.database, &user.id, Some(client.ip))?;
    audit::record(
        &state.database,
        AuditEntry::by_user(&user.id, action::LOGIN)
            .target(target::USER, &user.id)
            .from_ip(client.ip),
    );

    let view = user_envelope(&state, &user)?;
    Ok(with_session_cookie(
        StatusCode::OK,
        session_cookie(&token, state.is_public_secure()),
        Json(view),
    ))
}

pub async fn logout(State(state): State<SharedState>, session: SessionUser) -> ApiResult<Response> {
    destroy_session(&state.database, &session.token)?;
    Ok(with_session_cookie(
        StatusCode::NO_CONTENT,
        cleared_session_cookie(state.is_public_secure()),
        (),
    ))
}

pub async fn me(
    State(state): State<SharedState>,
    session: SessionUser,
) -> ApiResult<Json<UserEnvelope>> {
    Ok(Json(user_envelope(&state, &session.user)?))
}

pub async fn change_password(
    State(state): State<SharedState>,
    Client(client): Client,
    session: SessionUser,
    ApiJson(request): ApiJson<PasswordChangeRequest>,
) -> ApiResult<Response> {
    if !verify_password(&request.current_password, &session.user.password_hash) {
        return Err(ApiError::unauthorized(WRONG_CURRENT_PASSWORD));
    }
    let hash = hash_password(&validated_password(&request.new_password)?)
        .map_err(ApiError::bad_request)?;
    state.database.update_user(
        &session.user.id,
        &crate::db::UserUpdate {
            password_hash: Some(hash),
            ..Default::default()
        },
    )?;

    // Every session of this account is dropped and a fresh one issued: a password change has to
    // end whatever else was signed in, without logging this browser out of its own change.
    state.database.delete_sessions_of_user(&session.user.id)?;
    let token = create_session(&state.database, &session.user.id, Some(client.ip))?;
    audit::record(
        &state.database,
        AuditEntry::by_user(&session.user.id, action::USER_UPDATED)
            .target(target::USER, &session.user.id)
            .from_ip(client.ip)
            .detail("change", "password"),
    );
    Ok(with_session_cookie(
        StatusCode::NO_CONTENT,
        session_cookie(&token, state.is_public_secure()),
        (),
    ))
}

/// Checks a new password against the relay's floor.
pub fn validated_password(password: &str) -> ApiResult<String> {
    if password.chars().count() < MIN_PASSWORD_LENGTH {
        return Err(ApiError::bad_request(format!(
            "密码至少需要 {MIN_PASSWORD_LENGTH} 个字符。"
        )));
    }
    Ok(password.to_string())
}

/// Builds the `{ user }` envelope both `/api/auth/login` and `/api/me` answer with.
pub fn user_envelope(state: &SharedState, user: &crate::db::UserRecord) -> ApiResult<UserEnvelope> {
    let devices = state.database.list_devices_owned_by(&user.id)?;
    let context = ViewContext::build(state)?;
    Ok(UserEnvelope {
        user: context.user(user, live_device_count(&devices)),
    })
}

fn with_session_cookie(status: StatusCode, cookie: String, body: impl IntoResponse) -> Response {
    let mut response = (status, body).into_response();
    if let Ok(value) = axum::http::HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_password_is_refused_with_the_required_length() {
        let error = validated_password(&"a".repeat(MIN_PASSWORD_LENGTH - 1))
            .expect_err("it should be refused");

        assert_eq!(error.status(), StatusCode::BAD_REQUEST);
        assert!(validated_password(&"a".repeat(MIN_PASSWORD_LENGTH)).is_ok());
    }

    #[test]
    fn the_cookie_is_attached_to_an_empty_body_too() {
        let response = with_session_cookie(
            StatusCode::NO_CONTENT,
            "termexo_relay_session=abc; HttpOnly".into(),
            (),
        );

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response
                .headers()
                .get(header::SET_COOKIE)
                .expect("the cookie should be set"),
            "termexo_relay_session=abc; HttpOnly"
        );
    }
}
