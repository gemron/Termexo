use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};

use super::{tools, McpManager, McpSettings};

/// Transport depends only on authentication, capabilities and execution, keeping Tauri UI
/// dispatch out of HTTP parsing and allowing the real listener to be tested independently.
pub(super) trait McpBackend: Send + Sync + 'static {
    fn settings(&self) -> McpSettings;
    fn authorized(&self, token: &str) -> bool;
    fn call(
        self: Arc<Self>,
        name: String,
        arguments: Value,
    ) -> impl std::future::Future<Output = Result<Value, String>> + Send;
}

impl McpBackend for McpManager {
    fn settings(&self) -> McpSettings {
        self.settings()
    }
    fn authorized(&self, token: &str) -> bool {
        self.authorized(token)
    }
    async fn call(self: Arc<Self>, name: String, arguments: Value) -> Result<Value, String> {
        McpManager::call(&self, &name, arguments).await
    }
}

const SUPPORTED_VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26"];
const MAX_REQUEST_BYTES: usize = 1024 * 1024;

pub(super) fn router<B: McpBackend>(manager: Arc<B>) -> Router {
    Router::new()
        .route(
            "/mcp",
            post(handle::<B>).get(no_stream::<B>).delete(no_stream::<B>),
        )
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(manager)
}

fn validate_headers(headers: &HeaderMap, port: u16) -> Result<(), StatusCode> {
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::FORBIDDEN)?;
    if ![format!("127.0.0.1:{port}"), format!("localhost:{port}")].contains(&host.to_owned()) {
        return Err(StatusCode::FORBIDDEN);
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        if origin.to_str().ok() != Some(format!("http://{host}").as_str()) {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    if let Some(version) = headers.get("mcp-protocol-version") {
        if !version
            .to_str()
            .ok()
            .is_some_and(|v| SUPPORTED_VERSIONS.contains(&v))
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    Ok(())
}

fn authorize<B: McpBackend>(manager: &B, headers: &HeaderMap) -> Result<(), StatusCode> {
    let settings = manager.settings();
    if !settings.enabled {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    validate_headers(headers, settings.port)?;
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !manager.authorized(token) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(())
}

async fn no_stream<B: McpBackend>(State(manager): State<Arc<B>>, headers: HeaderMap) -> StatusCode {
    authorize(manager.as_ref(), &headers)
        .err()
        .unwrap_or(StatusCode::METHOD_NOT_ALLOWED)
}

fn error(id: Value, code: i32, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message} })
}

fn valid_message(message: &Value) -> bool {
    message.is_object()
        && message["jsonrpc"] == "2.0"
        && message["method"].is_string()
        && message
            .get("id")
            .is_none_or(|id| id.is_string() || id.is_i64() || id.is_u64())
        && message.get("params").is_none_or(Value::is_object)
}

fn initialize(params: &Value) -> Result<Value, &'static str> {
    let version = params["protocolVersion"]
        .as_str()
        .ok_or("Missing protocolVersion")?;
    if !params["capabilities"].is_object()
        || !params["clientInfo"]["name"].is_string()
        || !params["clientInfo"]["version"].is_string()
    {
        return Err("Invalid initialize parameters");
    }
    let version = if SUPPORTED_VERSIONS.contains(&version) {
        version
    } else {
        SUPPORTED_VERSIONS[0]
    };
    Ok(json!({
        "protocolVersion": version,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "termexo", "version": env!("CARGO_PKG_VERSION") },
        "instructions": "Control the running local Termexo desktop. Inspect workspaces, tasks and terminal state before acting. Terminal writes and task starts return before commands complete. Poll task_list or terminal_read. A timeout may follow a started operation; inspect state before retrying."
    }))
}

fn tool_result(result: Result<Value, String>) -> Value {
    match result {
        Ok(value) => json!({"content":[{"type":"text","text":value.to_string()}], "isError":false}),
        Err(message) => json!({"content":[{"type":"text","text":message}], "isError":true}),
    }
}

async fn handle<B: McpBackend>(
    State(manager): State<Arc<B>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(status) = authorize(manager.as_ref(), &headers) {
        return status.into_response();
    }
    if !headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(';').next() == Some("application/json"))
    {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    let accept = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !["application/json", "text/event-stream"]
        .iter()
        .all(|mime| {
            accept
                .split(',')
                .any(|v| v.trim().split(';').next() == Some(*mime))
        })
    {
        return StatusCode::NOT_ACCEPTABLE.into_response();
    }
    let message: Value = match serde_json::from_slice(&body) {
        Ok(message) => message,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(error(Value::Null, -32700, "Parse error")),
            )
                .into_response()
        }
    };
    if !valid_message(&message) {
        return (
            StatusCode::BAD_REQUEST,
            Json(error(Value::Null, -32600, "Invalid request")),
        )
            .into_response();
    }
    let method = message["method"].as_str().unwrap();
    let Some(id) = message.get("id") else {
        // Never execute a tool notification: a caller needs its result to distinguish errors.
        return if method.starts_with("notifications/") {
            StatusCode::ACCEPTED
        } else {
            StatusCode::BAD_REQUEST
        }
        .into_response();
    };
    let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
    let result = match method {
        "initialize" => initialize(&params).map_err(|message| (-32602, message.to_owned())),
        "ping" => Ok(json!({})),
        "tools/list" => {
            if params.get("cursor").is_some() {
                Err((-32602, "This server does not use pagination cursors".into()))
            } else {
                Ok(tools::list(&manager.settings()))
            }
        }
        "tools/call" => {
            let name = params["name"].as_str().unwrap_or("");
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match tools::catalog()
                .into_iter()
                .find(|tool| tool["name"] == name)
            {
                None => Err((-32602, "Unknown MCP tool".into())),
                Some(tool) => match tools::validate_arguments(&tool["inputSchema"], &arguments) {
                    Err(message) => Err((-32602, message)),
                    Ok(()) => {
                        if !tools::allowed(&tool, &manager.settings()) {
                            Ok(tool_result(Err(
                                "MCP access to this tool is disabled".into()
                            )))
                        } else {
                            Ok(tool_result(manager.call(name.into(), arguments).await))
                        }
                    }
                },
            }
        }
        _ => Err((-32601, "Method not found".into())),
    };
    let reply = match result {
        Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
        Err((code, message)) => error(id.clone(), code, &message),
    };
    Json(reply).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        RwLock,
    };

    struct TestBackend {
        settings: RwLock<McpSettings>,
        token: RwLock<String>,
        calls: AtomicUsize,
    }

    impl McpBackend for TestBackend {
        fn settings(&self) -> McpSettings {
            self.settings.read().unwrap().clone()
        }
        fn authorized(&self, token: &str) -> bool {
            *self.token.read().unwrap() == token
        }
        async fn call(self: Arc<Self>, name: String, arguments: Value) -> Result<Value, String> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            Ok(json!({"name":name,"arguments":arguments}))
        }
    }

    #[tokio::test]
    async fn real_http_transport_authenticates_discovers_dispatches_and_revokes() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let backend = Arc::new(TestBackend {
            settings: RwLock::new(McpSettings {
                enabled: true,
                port,
                ..Default::default()
            }),
            token: RwLock::new("test-token".into()),
            calls: AtomicUsize::new(0),
        });
        let endpoint = router(backend.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, endpoint).await.unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("http://127.0.0.1:{port}/mcp");
        let request = |message: Value| {
            client
                .post(&url)
                .bearer_auth("test-token")
                .header("Accept", "application/json, text/event-stream")
                .json(&message)
        };

        assert_eq!(
            client
                .post(&url)
                .json(&json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            request(json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
                .header("Origin", "https://evil.example")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
                .header("Host", "evil.example")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        let init: Value = request(json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}})).send().await.unwrap().json().await.unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(
            request(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::ACCEPTED
        );
        let discovered: Value = request(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let names: Vec<_> = discovered["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"terminal_write"));
        assert!(!names.contains(&"settings_update"));
        let reply: Value = request(json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"terminal_write","arguments":{"terminalId":"t","data":"hello"}}})).send().await.unwrap().json().await.unwrap();
        assert_eq!(reply["result"]["isError"], false);
        assert_eq!(backend.calls.load(Ordering::Relaxed), 1);
        backend.settings.write().unwrap().terminal_access = false;
        let refused: Value = request(json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"terminal_write","arguments":{"terminalId":"t","data":"hello"}}})).send().await.unwrap().json().await.unwrap();
        assert_eq!(refused["result"]["isError"], true);
        let invalid: Value = request(json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"task_execute","arguments":{"taskId":"task","extra":true}}})).send().await.unwrap().json().await.unwrap();
        assert_eq!(invalid["error"]["code"], -32602);
        assert_eq!(backend.calls.load(Ordering::Relaxed), 1);
        assert_eq!(
            client
                .get(&url)
                .bearer_auth("test-token")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        *backend.token.write().unwrap() = "rotated-token".into();
        assert_eq!(
            request(json!({"jsonrpc":"2.0","id":6,"method":"ping"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        backend.settings.write().unwrap().enabled = false;
        assert_eq!(
            request(json!({"jsonrpc":"2.0","id":7,"method":"ping"}))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::SERVICE_UNAVAILABLE
        );
        server.abort();
    }

    #[test]
    fn local_origin_and_protocol_are_checked() {
        let mut headers = HeaderMap::new();
        assert_eq!(validate_headers(&headers, 7421), Err(StatusCode::FORBIDDEN));
        headers.insert(header::HOST, "127.0.0.1:7421".parse().unwrap());
        assert!(validate_headers(&headers, 7421).is_ok());
        headers.insert(header::ORIGIN, "https://evil.example".parse().unwrap());
        assert_eq!(validate_headers(&headers, 7421), Err(StatusCode::FORBIDDEN));
        headers.insert(header::ORIGIN, "http://127.0.0.1:7421".parse().unwrap());
        assert!(validate_headers(&headers, 7421).is_ok());
        headers.insert("mcp-protocol-version", "unsupported".parse().unwrap());
        assert_eq!(
            validate_headers(&headers, 7421),
            Err(StatusCode::BAD_REQUEST)
        );
    }

    #[test]
    fn initialization_negotiates_supported_versions() {
        for version in ["2025-03-26", "2025-06-18", "2025-11-25", "future"] {
            let result = initialize(&json!({"protocolVersion":version,"capabilities":{},"clientInfo":{"name":"test","version":"1"}})).unwrap();
            assert_eq!(
                result["protocolVersion"],
                if version == "future" {
                    SUPPORTED_VERSIONS[0]
                } else {
                    version
                }
            );
        }
        assert!(initialize(&json!({})).is_err());
    }

    #[test]
    fn malformed_and_batch_requests_are_rejected() {
        assert!(!valid_message(&json!([])));
        assert!(!valid_message(
            &json!({"jsonrpc":"1.0","method":"tools/call","id":1})
        ));
        assert!(!valid_message(
            &json!({"jsonrpc":"2.0","method":"tools/call","id":null})
        ));
        assert!(!valid_message(
            &json!({"jsonrpc":"2.0","method":"tools/call","params":[]})
        ));
        assert!(valid_message(
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"})
        ));
    }
}
