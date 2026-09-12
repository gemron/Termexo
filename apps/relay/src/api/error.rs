//! The one error shape every `/api/*` endpoint answers with: a status and `{ "error": "…" }`.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

use crate::db::DatabaseError;

pub type ApiResult<T> = Result<T, ApiError>;

/// Shown instead of the real cause when something inside the relay went wrong. The detail belongs
/// in the log, not in a response a stranger can read.
const INTERNAL_MESSAGE: &str = "中继内部错误，请查看服务日志。";

#[derive(Debug, Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, message)
    }

    pub fn not_implemented(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_IMPLEMENTED, message)
    }

    /// Logs the real cause and answers with a generic sentence.
    pub fn internal(context: &str, error: impl std::fmt::Display) -> Self {
        tracing::error!(%error, context, "请求处理失败");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, INTERNAL_MESSAGE)
    }

    pub fn status(&self) -> StatusCode {
        self.status
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: &self.message,
            }),
        )
            .into_response()
    }
}

impl From<DatabaseError> for ApiError {
    fn from(error: DatabaseError) -> Self {
        match error {
            // The one database failure that is the caller's fault rather than the relay's.
            DatabaseError::UsernameTaken => {
                Self::conflict(DatabaseError::UsernameTaken.to_string())
            }
            other => Self::internal("database", other),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_taken_username_is_a_conflict_rather_than_an_internal_error() {
        let error = ApiError::from(DatabaseError::UsernameTaken);

        assert_eq!(error.status(), StatusCode::CONFLICT);
        assert_eq!(error.message, "用户名已被占用。");
    }

    #[test]
    fn an_unexpected_database_failure_never_leaks_its_detail() {
        let error = ApiError::from(DatabaseError::UnknownValue {
            field: "users.role",
            value: "root".into(),
        });

        assert_eq!(error.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(error.message, INTERNAL_MESSAGE);
    }
}
