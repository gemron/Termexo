//! The `/api/*` surface: the console's contract and the device enrollment endpoint.

mod audit;
mod devices;
mod enroll;
mod enrollments;
pub mod error;
mod relays;
mod sessions;
mod settings;
mod users;
mod views;

use std::net::SocketAddr;

use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{ConnectInfo, DefaultBodyLimit, FromRequest, FromRequestParts, Query, Request};
use axum::http::request::Parts;
use axum::http::{header, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::routing::{delete, get, patch, post};
use axum::Router;
use termexo_relay_protocol::tunnel::{ENROLL_PATH, HEALTH_PATH};

use crate::auth::session::{has_csrf_marker, read_session_cookie, resolve_session, CSRF_HEADER};
use crate::db::{now_millis, UserRecord};
use crate::forwarded::{self, ClientContext};
use crate::state::SharedState;
use error::{ApiError, ApiResult};

/// Largest JSON body a console request may carry. Everything here is a handful of short fields.
const MAX_API_BODY_BYTES: usize = 64 * 1024;

const NOT_LOGGED_IN: &str = "请先登录。";
const MALFORMED_JSON: &str = "请求内容不是合法的 JSON。";
const INCOMPLETE_JSON: &str = "请求内容缺少必要字段，或字段类型不正确。";
const MISSING_JSON_TYPE: &str = "请求缺少 Content-Type: application/json。";
const UNREADABLE_BODY: &str = "无法读取请求内容。";
const MALFORMED_QUERY: &str = "查询参数不正确。";
const ADMIN_REQUIRED: &str = "需要管理员权限。";
const CSRF_REQUIRED: &str = "缺少控制台请求标识，已拒绝。";
const UNKNOWN_ENDPOINT: &str = "接口不存在。";

/// The `/api/*` routes, minus the fallback and the tunnel, which the server assembles around them.
pub fn router() -> Router<SharedState> {
    Router::new()
        .route(HEALTH_PATH, get(settings::health))
        .route(ENROLL_PATH, post(enroll::enroll))
        .route("/api/auth/login", post(sessions::login))
        .route("/api/auth/logout", post(sessions::logout))
        .route("/api/me", get(sessions::me))
        .route("/api/me/password", post(sessions::change_password))
        .route("/api/devices", get(devices::list_own))
        .route("/api/devices/{id}", patch(devices::update_own))
        .route("/api/devices/{id}/revoke", post(devices::revoke_own))
        .route("/api/admin/users", get(users::list).post(users::create))
        .route(
            "/api/admin/users/{id}",
            patch(users::update).delete(users::delete),
        )
        .route("/api/admin/devices", get(devices::list_all))
        .route("/api/admin/devices/{id}", patch(devices::update_any))
        .route("/api/admin/devices/{id}/revoke", post(devices::revoke_any))
        .route(
            "/api/admin/devices/{id}/disconnect",
            post(devices::disconnect_any),
        )
        .route(
            "/api/admin/enrollments",
            get(enrollments::list).post(enrollments::create),
        )
        .route("/api/admin/enrollments/{id}", delete(enrollments::cancel))
        .route("/api/admin/relays", get(relays::list))
        .route(
            "/api/admin/relays/upstream",
            post(relays::set_upstream).delete(relays::clear_upstream),
        )
        .route("/api/admin/audit", get(audit::list))
        .route("/api/admin/settings", get(settings::settings))
        .layer(DefaultBodyLimit::max(MAX_API_BODY_BYTES))
}

/// Answers any `/api/*` path that no route claimed.
pub fn unknown_endpoint() -> Response {
    use axum::response::IntoResponse;
    ApiError::not_found(UNKNOWN_ENDPOINT).into_response()
}

/// Refuses a modifying console request that does not carry the console's marker header.
///
/// Enrollment and health are exempt: they are called by the desktop app, which is not a browser and
/// has no ambient cookie for an attacker to ride on.
pub async fn require_csrf_marker(request: Request, next: Next) -> Result<Response, ApiError> {
    let path = request.uri().path();
    let exempt = !path.starts_with("/api/") || path == ENROLL_PATH || path == HEALTH_PATH;
    let safe_method = matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    if exempt || safe_method {
        return Ok(next.run(request).await);
    }

    let marker = request
        .headers()
        .get(CSRF_HEADER)
        .and_then(|value| value.to_str().ok());
    if !has_csrf_marker(marker) {
        return Err(ApiError::forbidden(CSRF_REQUIRED));
    }
    Ok(next.run(request).await)
}

/// The browser behind a request, resolved through the forwarding rules.
pub struct Client(pub ClientContext);

impl FromRequestParts<SharedState> for Client {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &SharedState) -> ApiResult<Self> {
        let peer = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|ConnectInfo(address)| *address)
            .ok_or_else(|| ApiError::internal("connect-info", "缺少连接信息"))?;
        Ok(Self(forwarded::resolve(state, &parts.headers, peer)))
    }
}

/// A logged-in console account.
pub struct SessionUser {
    pub user: UserRecord,
    /// The cookie value, so logging out and changing a password can invalidate exactly this session.
    pub token: String,
}

impl FromRequestParts<SharedState> for SessionUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &SharedState) -> ApiResult<Self> {
        let token = parts
            .headers
            .get(header::COOKIE)
            .and_then(|value| value.to_str().ok())
            .and_then(read_session_cookie)
            .ok_or_else(|| ApiError::unauthorized(NOT_LOGGED_IN))?
            .to_string();
        let user = resolve_session(&state.database, &token, now_millis())?
            .ok_or_else(|| ApiError::unauthorized(NOT_LOGGED_IN))?;
        Ok(Self { user, token })
    }
}

/// A logged-in account that is allowed to manage the relay.
pub struct AdminUser(pub SessionUser);

impl FromRequestParts<SharedState> for AdminUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &SharedState) -> ApiResult<Self> {
        let session = SessionUser::from_request_parts(parts, state).await?;
        if !session.user.role.is_admin() {
            return Err(ApiError::forbidden(ADMIN_REQUIRED));
        }
        Ok(Self(session))
    }
}

/// `Json`, with the rejection rewritten into the `{ "error": "…" }` shape every other failure uses.
///
/// axum's own rejection is an English plain-text body, which the console cannot display and the
/// contract does not allow.
pub struct ApiJson<T>(pub T);

impl<T, S> FromRequest<S> for ApiJson<T>
where
    axum::Json<T>: FromRequest<S, Rejection = JsonRejection>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> ApiResult<Self> {
        axum::Json::<T>::from_request(request, state)
            .await
            .map(|axum::Json(value)| Self(value))
            .map_err(|rejection| ApiError::bad_request(describe_json_rejection(&rejection)))
    }
}

fn describe_json_rejection(rejection: &JsonRejection) -> &'static str {
    match rejection {
        JsonRejection::JsonDataError(_) => INCOMPLETE_JSON,
        JsonRejection::JsonSyntaxError(_) => MALFORMED_JSON,
        JsonRejection::MissingJsonContentType(_) => MISSING_JSON_TYPE,
        _ => UNREADABLE_BODY,
    }
}

/// `Query`, with the same rewritten rejection as [`ApiJson`].
pub struct ApiQuery<T>(pub T);

impl<T, S> FromRequestParts<S> for ApiQuery<T>
where
    Query<T>: FromRequestParts<S, Rejection = QueryRejection>,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> ApiResult<Self> {
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| Self(value))
            .map_err(|_| ApiError::bad_request(MALFORMED_QUERY))
    }
}

/// The empty success answer shared by every endpoint that has nothing to return.
pub fn no_content() -> StatusCode {
    StatusCode::NO_CONTENT
}

/// Trims a user-supplied label and refuses an empty one.
fn require_text(value: &str, field: &str, max_length: usize) -> ApiResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request(format!("{field}不能为空。")));
    }
    if trimmed.chars().count() > max_length {
        return Err(ApiError::bad_request(format!(
            "{field}不能超过 {max_length} 个字符。"
        )));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_label_is_trimmed_and_bounded() {
        assert_eq!(
            require_text("  书房台式机  ", "设备名称", 64).expect("it should pass"),
            "书房台式机"
        );
        assert!(require_text("   ", "设备名称", 64).is_err());
        assert!(require_text(&"名".repeat(65), "设备名称", 64).is_err());
    }
}
