use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::stream::{SplitSink, SplitStream, StreamExt};
use futures_util::SinkExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use termexo_relay_protocol::tunnel::{
    HEADER_FORWARDED_FOR, HEADER_FORWARDED_HOST, HEADER_FORWARDED_PROTO, HEADER_TERMEXO_BASE,
};
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time::{timeout, Instant};

use crate::remote::bridge::{self, RemoteEventHub};
use crate::remote::token::RemoteAuth;

pub const HEALTH_PATH: &str = "/api/health";
pub const WEBSOCKET_PATH: &str = "/ws";

const INDEX_ASSET: &str = "index.html";
const HTML_MIME_PREFIX: &str = "text/html";
const HTML_EXTENSIONS: [&str; 2] = ["html", "htm"];

/// What `<base href>` is when the workbench is served from the root, which is every LAN request.
const DEFAULT_BASE_HREF: &str = "/";
/// Start of the tag the bundler emits; its exact spelling (`/>` or `>`) is not relied upon.
const BASE_TAG_OPENING: &str = "<base";
/// A relay's base is `/d/<deviceId>/`, so anything remotely this long is not one.
const MAX_BASE_LENGTH: usize = 128;

const SECURE_FORWARDED_PROTO: &str = "https";

/// A client that never authenticates must not hold a slot open.
const AUTH_TIMEOUT: Duration = Duration::from_secs(5);
/// The client pings every 20 s, so three missed pings end the connection.
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
/// Enough for a burst of terminal output without letting a stalled socket buffer without bound.
const OUTBOUND_CAPACITY: usize = 256;

/// WebSocket close codes. 1001 is the standard "going away"; the 44xx values are application
/// specific and the frontend maps them onto its own reconnect behaviour.
const CLOSE_GOING_AWAY: u16 = 1001;
const CLOSE_UNAUTHORIZED: u16 = 4401;
const CLOSE_AUTH_TIMEOUT: u16 = 4408;

const UNKNOWN_PEER_MESSAGE: &str = "无法确定请求来源地址。";

/// Tells every open WebSocket task what the service wants it to do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionCommand {
    Run,
    /// The service is shutting down.
    Stop,
    /// The token was rotated, so every client has to present the new one.
    Reauthenticate,
}

impl ConnectionCommand {
    fn close_frame(self) -> Option<CloseFrame> {
        match self {
            Self::Run => None,
            Self::Stop => Some(CloseFrame {
                code: CLOSE_GOING_AWAY,
                reason: Utf8Bytes::from_static("远程访问服务已停止。"),
            }),
            Self::Reauthenticate => Some(CloseFrame {
                code: CLOSE_UNAUTHORIZED,
                reason: Utf8Bytes::from_static("访问令牌已更换，请重新连接。"),
            }),
        }
    }
}

/// Everything a request handler needs; cloned into every connection task behind an `Arc`.
pub struct ServerContext {
    pub app: AppHandle,
    pub hub: Arc<RemoteEventHub>,
    pub auth: Arc<RemoteAuth>,
    pub commands: watch::Receiver<ConnectionCommand>,
    /// LAN listener only: whether it terminates TLS itself.
    pub secure: bool,
    /// LAN listener only: the port a request's `Host` has to name.
    pub port: u16,
    pub version: String,
    /// Whether this router serves the relay tunnel rather than the LAN listener.
    ///
    /// Both routers share every handler; the three places that differ — origin validation, the
    /// source address and the shell document — branch on this rather than on the presence of a
    /// forwarding header, because a header can be forged on the local network and a listener
    /// cannot.
    pub via_relay: bool,
}

pub fn router(context: Arc<ServerContext>) -> Router {
    Router::new()
        .route(HEALTH_PATH, get(health))
        .route(WEBSOCKET_PATH, get(websocket))
        .fallback(static_asset)
        // `no-cache` means "revalidate", not "do not store": paired with the `ETag` below it lets a
        // browser answer a reload with a conditional request, so an unchanged bundle crosses the
        // tunnel once per version instead of once per refresh.
        .layer(axum::middleware::map_response(attach_no_cache))
        .with_state(context)
}

async fn attach_no_cache(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    version: String,
}

/// Unauthenticated on purpose: it only reports the version, and a client needs it to tell a
/// reachable Termexo apart from an unrelated service squatting on the port.
async fn health(State(context): State<Arc<ServerContext>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        version: context.version.clone(),
    })
}

/// How the shell document has to be rendered for one request.
///
/// The LAN listener always serves the workbench from the root over the scheme it terminates
/// itself; behind a relay both facts come from the entry relay's forwarding headers.
#[derive(Debug, PartialEq, Eq)]
struct DocumentContext {
    base: String,
    secure: bool,
}

impl DocumentContext {
    fn resolve(context: &ServerContext, headers: &HeaderMap) -> Self {
        if !context.via_relay {
            return Self {
                base: DEFAULT_BASE_HREF.to_string(),
                secure: context.secure,
            };
        }
        Self {
            base: sanitized_base(header_str(headers, HEADER_TERMEXO_BASE)),
            secure: header_str(headers, HEADER_FORWARDED_PROTO) == Some(SECURE_FORWARDED_PROTO),
        }
    }
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

/// Keeps a base path that could break out of the `href` attribute, or that is not an absolute
/// directory, from ever reaching the document; such a header means a broken relay, not a new form.
fn sanitized_base(raw: Option<&str>) -> String {
    let accepted = raw.filter(|value| {
        value.starts_with('/')
            && value.ends_with('/')
            // A protocol-relative base points the whole bundle at another host.
            && !value.starts_with("//")
            && !value.contains("..")
            && value.len() <= MAX_BASE_LENGTH
            && value.bytes().all(is_base_byte)
    });
    accepted.unwrap_or(DEFAULT_BASE_HREF).to_string()
}

const fn is_base_byte(byte: u8) -> bool {
    matches!(byte, b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'/' | b'-' | b'_' | b'.' | b'~')
}

async fn static_asset(
    State(context): State<Arc<ServerContext>>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    serve_asset(&context, &headers, uri.path())
}

fn serve_asset(context: &ServerContext, headers: &HeaderMap, request_path: &str) -> Response {
    let requested = request_path.trim_start_matches('/');
    // A path without a file extension is a client-side route, so it gets the shell document.
    let target = match asset_extension(requested) {
        Some(_) => requested.to_string(),
        None => INDEX_ASSET.to_string(),
    };

    let Some(asset) = context.app.asset_resolver().get(format!("/{target}")) else {
        // A resolvable shell document proves the bundle is there, so the miss is this file alone.
        let shell_available = target == INDEX_ASSET
            || context
                .app
                .asset_resolver()
                .get(format!("/{INDEX_ASSET}"))
                .is_some();
        return missing_asset_response(shell_available);
    };
    if is_production_html_fallback(&target, &asset.mime_type) {
        return (StatusCode::NOT_FOUND, "资源不存在。").into_response();
    }

    let page = DocumentContext::resolve(context, headers);
    let etag = asset_etag(&context.version, &target, &page.base);
    if matches_if_none_match(headers, &etag) {
        return (StatusCode::NOT_MODIFIED, [(header::ETAG, etag)]).into_response();
    }

    let response_headers = [
        (header::CONTENT_TYPE, asset.mime_type.clone()),
        (header::ETAG, etag),
    ];
    if target == INDEX_ASSET {
        let document = render_shell_document(
            &String::from_utf8_lossy(&asset.bytes),
            &context.version,
            &page,
        );
        return (response_headers, document).into_response();
    }
    (response_headers, asset.bytes).into_response()
}

/// The validator a conditional request is answered against.
///
/// It is weak because the shell document is rendered per request — the same version under the same
/// base is the same page, not the same bytes — and it carries the base because the very same asset
/// path is a different document behind a relay than it is on the LAN.
fn asset_etag(version: &str, target: &str, base: &str) -> String {
    format!("W/\"{version}:{base}:{target}\"")
}

fn matches_if_none_match(headers: &HeaderMap, etag: &str) -> bool {
    header_str(headers, header::IF_NONE_MATCH.as_str())
        .is_some_and(|value| value.split(',').any(|candidate| candidate.trim() == etag))
}

/// In dev the resolver reads `frontendDist` straight from disk and has no SPA fallback, so a miss
/// can mean either that the Angular bundle was never built or that this one file is absent. Only
/// the first is worth a 503 telling the user to build; a single missing file is an ordinary 404.
fn missing_asset_response(shell_available: bool) -> Response {
    match missing_asset_status(tauri::is_dev(), shell_available) {
        StatusCode::SERVICE_UNAVAILABLE => (
            StatusCode::SERVICE_UNAVAILABLE,
            "尚未构建前端产物，请先运行 npm run build。",
        )
            .into_response(),
        status => (status, "资源不存在。").into_response(),
    }
}

fn missing_asset_status(is_dev: bool, shell_available: bool) -> StatusCode {
    if is_dev && !shell_available {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    StatusCode::NOT_FOUND
}

fn asset_extension(path: &str) -> Option<&str> {
    let file = path.rsplit('/').next()?;
    let (_, extension) = file.rsplit_once('.')?;
    (!extension.is_empty()).then_some(extension)
}

/// Detects the production resolver answering a missing file with `index.html`.
///
/// `AppManager::get_asset` falls back to the shell document for any unknown path and sniffs the
/// result as `text/html`. Serving that for `main-ABC123.js` would hand the browser HTML where it
/// expects a script, so a real 404 is both more honest and easier to debug.
fn is_production_html_fallback(target: &str, mime_type: &str) -> bool {
    if target == INDEX_ASSET || !mime_type.starts_with(HTML_MIME_PREFIX) {
        return false;
    }
    !asset_extension(target)
        .map(|extension| HTML_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Renders `index.html` for one request: the descriptor the bundle reads, and — behind a relay —
/// the base path the browser resolves every asset and the WebSocket address against.
fn render_shell_document(document: &str, version: &str, page: &DocumentContext) -> String {
    let injected = inject_runtime_meta(document, &runtime_meta(version, page.secure));
    rewrite_base_href(&injected, &page.base)
}

/// The descriptor that tells the Angular bundle it is running remotely.
fn runtime_meta(version: &str, secure: bool) -> String {
    let descriptor = serde_json::json!({ "version": version, "secure": secure }).to_string();
    // The attribute is single-quoted so the JSON's own double quotes survive untouched.
    format!(
        "<meta name=\"termexo-remote\" content='{}'>",
        descriptor.replace('\'', "&#39;")
    )
}

fn inject_runtime_meta(document: &str, meta: &str) -> String {
    match document.find("</head>") {
        Some(index) => {
            let mut injected = String::with_capacity(document.len() + meta.len());
            injected.push_str(&document[..index]);
            injected.push_str(meta);
            injected.push_str(&document[index..]);
            injected
        }
        // No head to inject into: the meta still has to be parsed before the bundle runs.
        None => format!("{meta}{document}"),
    }
}

/// Points the document at the path the relay serves this device under.
///
/// The whole tag is replaced rather than the attribute, because the bundler decides whether it
/// writes `<base href="/">` or `<base href="/" />` and either spelling has to be retargeted.
fn rewrite_base_href(document: &str, base: &str) -> String {
    if base == DEFAULT_BASE_HREF {
        return document.to_string();
    }
    let Some(start) = document.find(BASE_TAG_OPENING) else {
        tracing::warn!("前端产物缺少 <base> 标签，经中继打开的页面将解析错资源地址");
        return document.to_string();
    };
    let Some(offset) = document[start..].find('>') else {
        return document.to_string();
    };
    let mut rewritten = String::with_capacity(document.len() + base.len());
    rewritten.push_str(&document[..start]);
    rewritten.push_str("<base href=\"");
    rewritten.push_str(base);
    rewritten.push_str("\">");
    rewritten.push_str(&document[start + offset + 1..]);
    rewritten
}

/// The address of the browser on the other end, whichever route the request came in on.
///
/// The failure lockout counts against it, so behind a relay it has to be the browser's own address:
/// counting the relay's egress address instead would lock every remote viewer out at once.
struct ClientPeer(IpAddr);

impl FromRequestParts<Arc<ServerContext>> for ClientPeer {
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(
        parts: &mut Parts,
        context: &Arc<ServerContext>,
    ) -> Result<Self, Self::Rejection> {
        let address = if context.via_relay {
            forwarded_peer(&parts.headers)
        } else {
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|ConnectInfo(peer)| peer.ip())
        };
        address
            .map(Self)
            .ok_or((StatusCode::FORBIDDEN, UNKNOWN_PEER_MESSAGE))
    }
}

/// The first entry of `X-Forwarded-For`, which the entry relay sets to the browser's own address.
fn forwarded_peer(headers: &HeaderMap) -> Option<IpAddr> {
    header_str(headers, HEADER_FORWARDED_FOR)?
        .split(',')
        .next()?
        .trim()
        .parse()
        .ok()
}

async fn websocket(
    State(context): State<Arc<ServerContext>>,
    ClientPeer(peer): ClientPeer,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if let Err(message) = validate_request_origin(&headers, &context) {
        return (StatusCode::FORBIDDEN, message).into_response();
    }
    upgrade.on_upgrade(move |socket| handle_connection(socket, context, peer))
}

fn validate_request_origin(
    headers: &HeaderMap,
    context: &ServerContext,
) -> Result<(), &'static str> {
    if context.via_relay {
        return validate_tunnel_origin(headers);
    }
    validate_lan_origin(headers, context.secure, context.port)
}

/// Rejects an upgrade whose `Host` or `Origin` is not this very service.
///
/// Without it any page the user visits could open a WebSocket to `https://127.0.0.1:7420` and,
/// with a leaked token, drive the workbench. The forwarding headers are deliberately not read
/// here: on the local network anyone can send them, and the listener already proves the route.
fn validate_lan_origin(headers: &HeaderMap, secure: bool, port: u16) -> Result<(), &'static str> {
    let host = header_str(headers, header::HOST.as_str()).ok_or("缺少 Host 头。")?;
    if host_port(host, secure) != Some(port) {
        return Err("Host 与服务端口不一致。");
    }
    if let Some(origin) = header_str(headers, header::ORIGIN.as_str()) {
        let scheme = if secure { "https" } else { "http" };
        if origin != format!("{scheme}://{host}") {
            return Err("Origin 与服务地址不一致。");
        }
    }
    Ok(())
}

/// Behind a relay the `Host` is the tunnel's synthetic authority, so the address the browser
/// actually typed is the one the entry relay forwards. Every page reaching this router came out of
/// a browser, so a missing `Origin` is a malformed request rather than a tolerable client.
fn validate_tunnel_origin(headers: &HeaderMap) -> Result<(), &'static str> {
    let proto = header_str(headers, HEADER_FORWARDED_PROTO).ok_or("缺少转发协议头。")?;
    let host = header_str(headers, HEADER_FORWARDED_HOST).ok_or("缺少转发主机头。")?;
    let origin = header_str(headers, header::ORIGIN.as_str()).ok_or("缺少 Origin 头。")?;
    if origin != format!("{proto}://{host}") {
        return Err("Origin 与中继地址不一致。");
    }
    Ok(())
}

fn host_port(host: &str, secure: bool) -> Option<u16> {
    // An IPv6 host is bracketed, so only the part after the closing bracket can carry a port.
    let authority = match host.strip_prefix('[').and(host.find(']')) {
        Some(end) => &host[end + 1..],
        None => host,
    };
    match authority.rsplit_once(':') {
        Some((_, port)) => port.parse().ok(),
        None => Some(if secure { 443 } else { 80 }),
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ClientFrame {
    Auth {
        token: String,
        /// Identifies the viewer so its terminal viewports can be released when it disconnects.
        #[serde(default, rename = "clientId")]
        client_id: String,
    },
    Invoke {
        id: i64,
        command: String,
        #[serde(default)]
        args: Option<Value>,
    },
    Ping,
    Pong,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ServerFrame {
    Ready {
        #[serde(rename = "serverVersion")]
        server_version: String,
    },
    AuthFailed {
        reason: String,
    },
    Result {
        id: i64,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<Value>,
    },
    /// The connection fell behind and lost events; the client has to replay from scratch.
    Resync,
    Pong,
}

impl ServerFrame {
    fn into_message(self) -> Message {
        match serde_json::to_string(&self) {
            Ok(encoded) => Message::text(encoded),
            Err(error) => {
                tracing::warn!(%error, "无法序列化远程帧");
                Message::text("{\"type\":\"resync\"}")
            }
        }
    }
}

type SocketSink = SplitSink<WebSocket, Message>;
type SocketStream = SplitStream<WebSocket>;

/// Drops a disconnected viewer's terminal viewports, whatever ended the connection.
struct ViewportGuard {
    app: AppHandle,
    client_id: String,
}

impl Drop for ViewportGuard {
    fn drop(&mut self) {
        if self.client_id.is_empty() {
            return;
        }
        self.app
            .state::<crate::pty::PtyManager>()
            .remove_viewer(&self.client_id, &self.app);
    }
}

async fn handle_connection(socket: WebSocket, context: Arc<ServerContext>, peer: IpAddr) {
    let (mut sink, mut stream) = socket.split();
    let Ok(client_id) = authenticate(&mut sink, &mut stream, &context, peer).await else {
        return;
    };

    // Counted only once authenticated, so a probe cannot inflate the client count shown in the
    // settings panel.
    let _client = context.hub.register_client();
    // Releases this viewer's terminal viewports however the connection ends, so the terminals it
    // was holding at its own width can grow back for whoever is still watching.
    let _viewports = ViewportGuard {
        app: context.app.clone(),
        client_id,
    };
    let (outbound, mut outbound_rx) = mpsc::channel::<Message>(OUTBOUND_CAPACITY);
    // Command results arrive from spawned tasks, so exactly one task owns the sink.
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(message) = outbound_rx.recv().await {
            if sink.send(message).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let mut events = context.hub.subscribe();
    let mut commands = context.commands.clone();
    let mut idle_deadline = Instant::now() + IDLE_TIMEOUT;

    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(idle_deadline) => {
                send_close(&outbound, CLOSE_GOING_AWAY, "连接空闲超时。").await;
                break;
            }
            changed = commands.changed() => {
                if changed.is_err() {
                    break;
                }
                let command = *commands.borrow_and_update();
                if let Some(frame) = command.close_frame() {
                    let _ = outbound.send(Message::Close(Some(frame))).await;
                    break;
                }
            }
            event = events.recv() => match event {
                Ok(frame) => {
                    if outbound.send(Message::text(frame.as_ref())).await.is_err() {
                        break;
                    }
                }
                // The client consumed events more slowly than the PTYs produced them, so the
                // gap is announced instead of silently delivering a torn stream.
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(%peer, skipped, "远程客户端事件积压，已请求重新同步");
                    if outbound.send(ServerFrame::Resync.into_message()).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            incoming = stream.next() => {
                let Some(Ok(message)) = incoming else { break };
                idle_deadline = Instant::now() + IDLE_TIMEOUT;
                if !handle_client_message(message, &context, &outbound, peer).await {
                    break;
                }
            }
        }
    }

    drop(outbound);
    let _ = writer.await;
}

/// Returns `false` when the connection should end.
async fn handle_client_message(
    message: Message,
    context: &Arc<ServerContext>,
    outbound: &mpsc::Sender<Message>,
    peer: IpAddr,
) -> bool {
    let text = match message {
        Message::Text(text) => text,
        Message::Close(_) => return false,
        // Ping/Pong are answered by the WebSocket layer and binary frames carry no protocol.
        _ => return true,
    };
    let frame = match serde_json::from_str::<ClientFrame>(text.as_str()) {
        Ok(frame) => frame,
        Err(error) => {
            tracing::warn!(%peer, %error, "远程客户端发送了无法解析的帧");
            return true;
        }
    };

    match frame {
        ClientFrame::Ping => outbound
            .send(ServerFrame::Pong.into_message())
            .await
            .is_ok(),
        // Already authenticated; a repeated handshake is a no-op rather than a reason to drop.
        ClientFrame::Auth { .. } | ClientFrame::Pong => true,
        ClientFrame::Invoke { id, command, args } => {
            spawn_invoke(
                context.app.clone(),
                outbound.clone(),
                peer,
                id,
                command,
                args,
            );
            true
        }
    }
}

/// Runs one command off the read loop so a slow command cannot stall terminal input.
fn spawn_invoke(
    app: AppHandle,
    outbound: mpsc::Sender<Message>,
    peer: IpAddr,
    id: i64,
    command: String,
    args: Option<Value>,
) {
    tauri::async_runtime::spawn(async move {
        let started = std::time::Instant::now();
        let args = args.unwrap_or_else(|| Value::Object(Default::default()));
        let outcome = bridge::dispatch(&app, command.clone(), args).await;
        tracing::debug!(
            %peer,
            %command,
            elapsed_ms = started.elapsed().as_millis() as u64,
            ok = outcome.is_ok(),
            "远程命令已处理"
        );
        let frame = match outcome {
            Ok(value) => ServerFrame::Result {
                id,
                ok: true,
                value: Some(value),
                error: None,
            },
            Err(error) => ServerFrame::Result {
                id,
                ok: false,
                value: None,
                error: Some(error),
            },
        };
        let _ = outbound.send(frame.into_message()).await;
    });
}

async fn authenticate(
    sink: &mut SocketSink,
    stream: &mut SocketStream,
    context: &Arc<ServerContext>,
    peer: IpAddr,
) -> Result<String, ()> {
    let first = timeout(AUTH_TIMEOUT, stream.next()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        close_sink(sink, CLOSE_AUTH_TIMEOUT, "未在规定时间内完成鉴权。").await;
        return Err(());
    };
    let Ok(ClientFrame::Auth { token, client_id }) =
        serde_json::from_str::<ClientFrame>(text.as_str())
    else {
        reject(sink, "第一帧必须是鉴权帧。").await;
        return Err(());
    };

    if let Err(rejection) = context.auth.authorize(peer, &token) {
        // The token itself is never logged, only that this address failed.
        tracing::warn!(%peer, reason = rejection.reason(), "远程鉴权失败");
        reject(sink, rejection.reason()).await;
        return Err(());
    }

    let ready = ServerFrame::Ready {
        server_version: context.version.clone(),
    };
    sink.send(ready.into_message()).await.map_err(|_| ())?;
    Ok(client_id)
}

async fn reject(sink: &mut SocketSink, reason: &str) {
    let frame = ServerFrame::AuthFailed {
        reason: reason.to_string(),
    };
    let _ = sink.send(frame.into_message()).await;
    close_sink(sink, CLOSE_UNAUTHORIZED, reason).await;
}

async fn close_sink(sink: &mut SocketSink, code: u16, reason: &str) {
    let _ = sink
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: Utf8Bytes::from(reason.to_string()),
        })))
        .await;
    let _ = sink.close().await;
}

async fn send_close(outbound: &mpsc::Sender<Message>, code: u16, reason: &str) {
    let _ = outbound
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: Utf8Bytes::from(reason.to_string()),
        })))
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    const RELAY_BASE: &str = "/d/abcdefghijklmnopqrstuvwxyz/";
    const SHELL_DOCUMENT: &str = "<html><head><base href=\"/\" /><title>a</title></head><body>";

    fn headers_of(entries: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in entries {
            headers.insert(
                axum::http::HeaderName::from_bytes(name.as_bytes()).expect("valid header name"),
                HeaderValue::from_str(value).expect("valid header"),
            );
        }
        headers
    }

    /// The forwarding headers a relay sets on every request it proxies.
    fn forwarded_headers() -> HeaderMap {
        headers_of(&[
            (HEADER_FORWARDED_FOR, "203.0.113.7"),
            (HEADER_FORWARDED_PROTO, "https"),
            (HEADER_FORWARDED_HOST, "relay.example.com"),
            (HEADER_TERMEXO_BASE, RELAY_BASE),
        ])
    }

    #[test]
    fn only_the_last_path_segment_decides_whether_a_path_has_an_extension() {
        assert_eq!(asset_extension("main-ABC.js"), Some("js"));
        assert_eq!(asset_extension("assets/logo.svg"), Some("svg"));
        assert_eq!(asset_extension("workspaces/id.with.dots/panel"), None);
        assert_eq!(asset_extension(""), None);
        assert_eq!(asset_extension("noext"), None);
    }

    #[test]
    fn a_missing_script_answered_with_the_shell_document_is_a_404() {
        assert!(is_production_html_fallback("main-ABC.js", "text/html"));
        assert!(is_production_html_fallback(
            "assets/data.json",
            "text/html; charset=utf-8"
        ));
    }

    /// Only an unbuilt bundle earns the "run npm run build" answer. Reporting it for every miss
    /// would tell a developer whose bundle is fine to rebuild it over one absent file.
    #[test]
    fn only_a_missing_bundle_reports_that_the_frontend_is_unbuilt() {
        assert_eq!(
            missing_asset_status(true, false),
            StatusCode::SERVICE_UNAVAILABLE
        );
        assert_eq!(missing_asset_status(true, true), StatusCode::NOT_FOUND);
        // Production embeds the bundle, so a miss there is always just a missing file.
        assert_eq!(missing_asset_status(false, false), StatusCode::NOT_FOUND);
        assert_eq!(missing_asset_status(false, true), StatusCode::NOT_FOUND);
    }

    #[test]
    fn real_assets_and_the_shell_document_itself_are_served() {
        assert!(!is_production_html_fallback("index.html", "text/html"));
        assert!(!is_production_html_fallback("offline.html", "text/html"));
        assert!(!is_production_html_fallback(
            "main-ABC.js",
            "text/javascript"
        ));
    }

    #[test]
    fn the_runtime_descriptor_goes_in_before_the_head_closes() {
        let injected = inject_runtime_meta("<html><head><title>a</title></head><body>", "<meta>");

        assert_eq!(injected, "<html><head><title>a</title><meta></head><body>");
    }

    #[test]
    fn a_document_without_a_head_still_receives_the_descriptor_first() {
        assert_eq!(inject_runtime_meta("<body>", "<meta>"), "<meta><body>");
    }

    #[test]
    fn the_runtime_descriptor_carries_the_version_and_the_security_flag() {
        let meta = runtime_meta("0.7.0", true);

        assert!(meta.starts_with("<meta name=\"termexo-remote\" content='"));
        assert!(meta.contains("\"version\":\"0.7.0\""));
        assert!(meta.contains("\"secure\":true"));
        assert!(meta.ends_with("'>"));
    }

    #[test]
    fn single_quotes_in_the_descriptor_cannot_close_the_attribute() {
        let meta = runtime_meta("0.7.0'\"><script>", true);

        assert!(
            !meta[meta.find("content='").unwrap() + "content='".len()..meta.len() - 2]
                .contains('\'')
        );
    }

    #[test]
    fn a_host_without_a_port_falls_back_to_the_scheme_default() {
        assert_eq!(host_port("192.168.1.20", true), Some(443));
        assert_eq!(host_port("192.168.1.20", false), Some(80));
        assert_eq!(host_port("192.168.1.20:7420", true), Some(7420));
        assert_eq!(host_port("[::1]", true), Some(443));
        assert_eq!(host_port("[::1]:7420", true), Some(7420));
    }

    #[test]
    fn upgrades_from_this_service_are_accepted() {
        let headers = headers_of(&[
            (header::HOST.as_str(), "192.168.1.20:7420"),
            (header::ORIGIN.as_str(), "https://192.168.1.20:7420"),
        ]);

        assert!(validate_lan_origin(&headers, true, 7420).is_ok());
    }

    #[test]
    fn upgrades_from_another_page_or_another_port_are_refused() {
        let foreign_origin = headers_of(&[
            (header::HOST.as_str(), "192.168.1.20:7420"),
            (header::ORIGIN.as_str(), "https://evil.example"),
        ]);
        assert!(validate_lan_origin(&foreign_origin, true, 7420).is_err());

        let wrong_scheme = headers_of(&[
            (header::HOST.as_str(), "192.168.1.20:7420"),
            (header::ORIGIN.as_str(), "http://192.168.1.20:7420"),
        ]);
        assert!(validate_lan_origin(&wrong_scheme, true, 7420).is_err());

        let wrong_port = headers_of(&[(header::HOST.as_str(), "192.168.1.20:9999")]);
        assert!(validate_lan_origin(&wrong_port, true, 7420).is_err());

        assert!(validate_lan_origin(&HeaderMap::new(), true, 7420).is_err());
    }

    /// The forwarding headers describe the entry relay, and only the tunnel route may believe
    /// them: on the local network anyone can send them, so reading them there would let a page
    /// on another origin talk its way past the check.
    #[test]
    fn the_lan_route_ignores_forged_forwarding_headers() {
        let mut headers = forwarded_headers();
        headers.insert(header::HOST, HeaderValue::from_static("192.168.1.20:7420"));
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://relay.example.com"),
        );

        // The `Origin` matches the forwarded host, and the LAN route still refuses it.
        assert!(validate_lan_origin(&headers, true, 7420).is_err());
        assert!(validate_tunnel_origin(&headers).is_ok());
    }

    #[test]
    fn the_tunnel_route_compares_the_origin_with_the_forwarded_address() {
        let mut headers = forwarded_headers();
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://relay.example.com"),
        );
        assert!(validate_tunnel_origin(&headers).is_ok());

        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://evil.example"),
        );
        assert!(validate_tunnel_origin(&headers).is_err());
    }

    /// A request without the relay's own headers did not come through the relay.
    #[test]
    fn the_tunnel_route_refuses_a_request_without_the_forwarding_headers() {
        let origin_only = headers_of(&[(header::ORIGIN.as_str(), "https://relay.example.com")]);
        assert!(validate_tunnel_origin(&origin_only).is_err());

        assert!(validate_tunnel_origin(&forwarded_headers()).is_err());
    }

    #[test]
    fn the_browser_address_comes_from_the_first_forwarded_entry() {
        let chained = headers_of(&[(HEADER_FORWARDED_FOR, "203.0.113.7, 10.0.0.1")]);

        assert_eq!(
            forwarded_peer(&chained),
            Some("203.0.113.7".parse::<IpAddr>().expect("a valid address"))
        );
        assert_eq!(forwarded_peer(&HeaderMap::new()), None);
        assert_eq!(
            forwarded_peer(&headers_of(&[(HEADER_FORWARDED_FOR, "not-an-address")])),
            None
        );
    }

    #[test]
    fn the_relay_base_replaces_the_base_tag_whatever_its_spelling() {
        let rewritten = rewrite_base_href(SHELL_DOCUMENT, RELAY_BASE);

        assert!(rewritten.contains(&format!("<base href=\"{RELAY_BASE}\">")));
        assert!(!rewritten.contains("href=\"/\""));
        assert!(rewritten.contains("<title>a</title>"));
        assert_eq!(
            rewrite_base_href("<html><head><base href=\"/\"></head>", RELAY_BASE),
            format!("<html><head><base href=\"{RELAY_BASE}\"></head>")
        );
    }

    #[test]
    fn a_document_served_from_the_root_keeps_its_base_tag() {
        assert_eq!(
            rewrite_base_href(SHELL_DOCUMENT, DEFAULT_BASE_HREF),
            SHELL_DOCUMENT
        );
    }

    /// A base that could close the attribute would inject markup into the shell document.
    #[test]
    fn only_an_absolute_directory_path_is_accepted_as_a_base() {
        assert_eq!(sanitized_base(Some(RELAY_BASE)), RELAY_BASE);
        assert_eq!(sanitized_base(None), DEFAULT_BASE_HREF);
        for forged in [
            "/d/x/\"><script>alert(1)</script>",
            "d/x/",
            "/d/x",
            "//evil.example/",
            "/d/../../etc/",
            "/d/ x/",
        ] {
            assert_eq!(
                sanitized_base(Some(forged)),
                DEFAULT_BASE_HREF,
                "{forged} should not reach the document"
            );
        }
    }

    #[test]
    fn a_base_longer_than_any_device_path_is_refused() {
        let long = format!("/{}/", "a".repeat(MAX_BASE_LENGTH));

        assert_eq!(sanitized_base(Some(&long)), DEFAULT_BASE_HREF);
    }

    #[test]
    fn the_shell_document_is_rendered_for_the_route_it_is_served_on() {
        let page = DocumentContext {
            base: RELAY_BASE.to_string(),
            secure: true,
        };

        let rendered = render_shell_document(SHELL_DOCUMENT, "0.9.0", &page);

        assert!(rendered.contains(&format!("<base href=\"{RELAY_BASE}\">")));
        assert!(rendered.contains("\"secure\":true"));
        assert!(rendered.contains("termexo-remote"));
    }

    /// The same path is a different document behind a relay, so the tag has to say so; otherwise
    /// a browser that opened the device on the LAN would reuse that copy through the tunnel.
    #[test]
    fn the_validator_covers_the_version_the_path_and_the_base() {
        let lan = asset_etag("0.9.0", INDEX_ASSET, DEFAULT_BASE_HREF);
        let tunnel = asset_etag("0.9.0", INDEX_ASSET, RELAY_BASE);

        assert!(lan.starts_with("W/\""));
        assert_ne!(lan, tunnel);
        assert_ne!(lan, asset_etag("0.9.1", INDEX_ASSET, DEFAULT_BASE_HREF));
        assert_ne!(lan, asset_etag("0.9.0", "main-ABC.js", DEFAULT_BASE_HREF));
    }

    #[test]
    fn a_conditional_request_matches_the_tag_it_was_given() {
        let etag = asset_etag("0.9.0", INDEX_ASSET, DEFAULT_BASE_HREF);

        assert!(matches_if_none_match(
            &headers_of(&[(header::IF_NONE_MATCH.as_str(), &etag)]),
            &etag
        ));
        // Browsers send every tag they hold for the resource, separated by commas.
        assert!(matches_if_none_match(
            &headers_of(&[(
                header::IF_NONE_MATCH.as_str(),
                &format!("W/\"stale\", {etag}")
            )]),
            &etag
        ));
        assert!(!matches_if_none_match(
            &headers_of(&[(header::IF_NONE_MATCH.as_str(), "W/\"0.8.0:/:index.html\"")]),
            &etag
        ));
        assert!(!matches_if_none_match(&HeaderMap::new(), &etag));
    }

    #[test]
    fn client_frames_use_the_documented_wire_shape() {
        let auth = serde_json::from_str::<ClientFrame>(
            "{\"type\":\"auth\",\"token\":\"t\",\"clientId\":\"c\"}",
        )
        .expect("an auth frame should parse");
        // The client id identifies the viewer whose terminal viewports end with the connection.
        assert!(
            matches!(auth, ClientFrame::Auth { token, client_id } if token == "t" && client_id == "c")
        );

        let invoke = serde_json::from_str::<ClientFrame>(
            "{\"type\":\"invoke\",\"id\":7,\"command\":\"list_workspaces\"}",
        )
        .expect("an invoke frame should parse");
        assert!(matches!(
            invoke,
            ClientFrame::Invoke { id: 7, ref command, args: None } if command == "list_workspaces"
        ));

        assert!(matches!(
            serde_json::from_str::<ClientFrame>("{\"type\":\"ping\"}"),
            Ok(ClientFrame::Ping)
        ));
    }

    #[test]
    fn server_frames_use_the_documented_wire_shape() {
        let ready = serde_json::to_string(&ServerFrame::Ready {
            server_version: "0.7.0".into(),
        })
        .expect("the frame should serialize");
        assert_eq!(ready, "{\"type\":\"ready\",\"serverVersion\":\"0.7.0\"}");

        let failed = serde_json::to_string(&ServerFrame::AuthFailed {
            reason: "no".into(),
        })
        .expect("the frame should serialize");
        assert_eq!(failed, "{\"type\":\"auth-failed\",\"reason\":\"no\"}");

        let ok = serde_json::to_string(&ServerFrame::Result {
            id: 1,
            ok: true,
            value: Some(Value::Null),
            error: None,
        })
        .expect("the frame should serialize");
        assert_eq!(
            ok,
            "{\"type\":\"result\",\"id\":1,\"ok\":true,\"value\":null}"
        );

        assert_eq!(
            serde_json::to_string(&ServerFrame::Resync).expect("the frame should serialize"),
            "{\"type\":\"resync\"}"
        );
    }

    #[test]
    fn stopping_and_rotating_close_with_distinguishable_codes() {
        assert!(ConnectionCommand::Run.close_frame().is_none());
        assert_eq!(
            ConnectionCommand::Stop
                .close_frame()
                .expect("stopping should close")
                .code,
            CLOSE_GOING_AWAY
        );
        assert_eq!(
            ConnectionCommand::Reauthenticate
                .close_frame()
                .expect("rotating should close")
                .code,
            CLOSE_UNAUTHORIZED
        );
    }
}
