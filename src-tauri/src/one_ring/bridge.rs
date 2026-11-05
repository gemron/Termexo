//! Presentation-only transport. Tasks and lifecycle remain owned by the external plugin.
use super::{settings::Settings, OneRingManager};
use crate::database::WorkspaceDatabase;
use crate::platform::shell_quote;
use crate::pty::PtyManager;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

pub(super) struct Host {
    pub token: String,
    pub workspace_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenWorker {
    cwd: String,
    title: String,
    runner: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest {
    id: String,
    workspace_id: String,
    host_terminal_id: String,
    title: String,
    cwd: String,
    command: String,
    deadline: u64,
}

pub(super) fn router(manager: Arc<OneRingManager>) -> Router {
    Router::new()
        .route("/worker", post(open))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .with_state(manager)
}

fn runner_command(state: &Path, runner: &Path, node: &str) -> Result<String, String> {
    let root = state
        .join("sessions")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let file = runner.canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(&root)
        || !file.is_file()
        || file.file_name().and_then(|v| v.to_str()) != Some("terminal.mjs")
    {
        return Err("Worker 启动文件不属于 One Ring 会话目录。".into());
    }
    Ok(format!(
        "exec {} {}",
        shell_quote(node),
        shell_quote(&file.to_string_lossy())
    ))
}

async fn open(
    State(manager): State<Arc<OneRingManager>>,
    headers: HeaderMap,
    Json(request): Json<OpenWorker>,
) -> Result<StatusCode, (StatusCode, String)> {
    if headers.contains_key(header::ORIGIN) {
        return Err((StatusCode::FORBIDDEN, "不支持浏览器请求。".into()));
    }
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    let (terminal_id, workspace_id) = {
        let hosts = manager.hosts.lock().map_err(internal)?;
        let (id, host) = hosts
            .iter()
            .find(|(_, host)| crate::remote::token::tokens_match(&host.token, token))
            .ok_or((StatusCode::UNAUTHORIZED, "One Ring Host 未授权。".into()))?;
        (id.clone(), host.workspace_id.clone())
    };
    let settings = Settings::load(&manager.app.state::<WorkspaceDatabase>()).map_err(internal)?;
    if !settings.enabled {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "One Ring 插件已禁用。".into(),
        ));
    }
    if manager
        .app
        .state::<PtyManager>()
        .attachment(&terminal_id)
        .map_err(internal)?
        .is_none()
    {
        manager.hosts.lock().map_err(internal)?.remove(&terminal_id);
        return Err((StatusCode::GONE, "One Ring Host 终端已结束。".into()));
    }
    let cwd = Path::new(&request.cwd);
    if !cwd.is_absolute() || !cwd.is_dir() || request.title.len() > 512 {
        return Err((StatusCode::BAD_REQUEST, "Worker 目录或标题无效。".into()));
    }
    let command = runner_command(
        &manager.state_directory(),
        Path::new(&request.runner),
        &settings.node_path,
    )
    .map_err(|e| (StatusCode::FORBIDDEN, e))?;
    let id = crate::remote::token::generate_token().map_err(internal)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    manager
        .pending
        .lock()
        .map_err(internal)?
        .insert(id.clone(), sender);
    let deadline = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(internal)?
        .as_millis() as u64
        + 8000;
    let event = WorkerRequest {
        id: id.clone(),
        workspace_id,
        host_terminal_id: terminal_id,
        title: request.title,
        cwd: request.cwd,
        command,
        deadline,
    };
    let result = match manager.app.emit_to("main", "one-ring-worker-open", event) {
        Ok(()) => match tokio::time::timeout(Duration::from_secs(8), receiver).await {
            Ok(Ok(result)) => result,
            _ => Err("工作台未及时打开 One Ring Worker 终端。".into()),
        },
        Err(error) => Err(error.to_string()),
    };
    manager.pending.lock().map_err(internal)?.remove(&id);
    result.map_err(internal)?;
    Ok(StatusCode::CREATED)
}

fn internal(error: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runner_must_stay_in_the_managed_session_directory() {
        let root = std::env::temp_dir().join(format!(
            "termexo-ring-path-{}",
            crate::remote::token::generate_token().unwrap()
        ));
        let session = root.join("sessions/worker");
        std::fs::create_dir_all(&session).unwrap();
        std::fs::write(session.join("terminal.mjs"), "runner").unwrap();
        std::fs::write(root.join("terminal.mjs"), "outside").unwrap();
        assert!(runner_command(&root, &session.join("terminal.mjs"), "/node dir/node").is_ok());
        assert!(runner_command(&root, &root.join("terminal.mjs"), "/node").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("terminal.mjs"), session.join("escape.mjs"))
                .unwrap();
            assert!(runner_command(&root, &session.join("escape.mjs"), "/node").is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
