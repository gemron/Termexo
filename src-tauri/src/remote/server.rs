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
use data_encoding::BASE64URL_NOPAD;
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
use crate::remote::session_crypto::{
    decode_nonce, Direction, FrameOpener, FrameSealer, HandshakeNonce, SealedFrame, SessionSecrets,
    PROTOCOL_VERSION,
};
use crate::remote::token::{AuthRejection, RemoteAuth};

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
/// A frame that broke the session envelope: not a client error to retry, an attack to end.
const CLOSE_PROTOCOL_ERROR: u16 = 1002;
const CLOSE_UNAUTHORIZED: u16 = 4401;
const CLOSE_AUTH_TIMEOUT: u16 = 4408;

const UNKNOWN_PEER_MESSAGE: &str = "无法确定请求来源地址。";
const HANDSHAKE_EXPECTED_MESSAGE: &str = "第一帧必须是鉴权帧。";
const MALFORMED_HANDSHAKE_MESSAGE: &str = "握手参数格式不正确。";
/// Refuses the v1 handshake where the page could have sealed the session, so a man in the middle
/// cannot force the downgrade and read the token out of the `auth` frame.
const SEALED_REQUIRED_MESSAGE: &str = "此连接要求加密握手，请改用 HTTPS 打开远程工作台。";
const UNSEALED_FRAME_MESSAGE: &str = "加密会话上收到了未封装的帧。";
const UNEXPECTED_SEAL_MESSAGE: &str = "未完成加密握手就发送了封装帧。";
const NESTED_SEAL_MESSAGE: &str = "封装帧内不允许再嵌套封装帧。";

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
    let sealed_required = requires_sealed_session(
        context.via_relay,
        DocumentContext::resolve(&context, &headers).secure,
    );
    upgrade.on_upgrade(move |socket| handle_connection(socket, context, peer, sealed_required))
}

/// Whether this connection has to complete the sealed v2 handshake.
///
/// Everything a relay carries crosses a machine the user may not own, and every page served over
/// https has WebCrypto, so both refuse the v1 frame: tolerating it would let a man in the middle
/// force the downgrade and read the token out of the handshake. That leaves one case where v1
/// survives — a plain-http page on the local network — and there the browser withholds
/// `crypto.subtle` entirely while the hop never had any confidentiality to lose.
fn requires_sealed_session(via_relay: bool, page_is_secure: bool) -> bool {
    via_relay || page_is_secure
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

/// The handshake frame, in either of the two shapes a client may send it.
///
/// A v1 client carries the token itself; a v2 client carries its half of the nonce and a proof
/// that it holds the token, and the token never crosses the wire at all.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthFrame {
    /// Absent on a v1 frame, which is exactly how the two are told apart.
    #[serde(default = "legacy_protocol")]
    protocol: u8,
    /// Identifies the viewer so its terminal viewports can be released when it disconnects.
    #[serde(default)]
    client_id: String,
    /// v1 only: the access token in the clear.
    #[serde(default)]
    token: String,
    /// v2 only: the client's half of the handshake nonce, base64url.
    #[serde(default)]
    nonce_c: String,
    /// v2 only: HMAC over both nonces under the key derived from the token, base64url.
    #[serde(default)]
    proof: String,
}

const fn legacy_protocol() -> u8 {
    1
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ClientFrame {
    Auth(AuthFrame),
    /// Every frame of a sealed session; the read loop unwraps it before acting on what is inside.
    Sealed(SealedFrame),
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
    /// The first frame on every connection: the server's half of the handshake nonce, and the
    /// highest protocol it speaks.
    Challenge {
        protocol: u8,
        #[serde(rename = "nonceS")]
        nonce_s: String,
    },
    /// Every frame of a sealed session travels inside this one.
    Sealed(SealedFrame),
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

/// What one handshake produced: who the viewer is, and — on a v2 session — the envelope layer
/// every later frame passes through.
struct Session {
    client_id: String,
    sealer: Option<FrameSealer>,
    opener: Option<FrameOpener>,
}

async fn handle_connection(
    socket: WebSocket,
    context: Arc<ServerContext>,
    peer: IpAddr,
    sealed_required: bool,
) {
    let (mut sink, mut stream) = socket.split();
    let Ok(session) = authenticate(&mut sink, &mut stream, &context, peer, sealed_required).await
    else {
        return;
    };
    let Session {
        client_id,
        mut sealer,
        mut opener,
    } = session;

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
    // Command results arrive from spawned tasks, so exactly one task owns the sink — which is also
    // what keeps the seal counters in step with the order the frames actually leave.
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(message) = outbound_rx.recv().await {
            let message = match sealer.as_mut() {
                Some(sealer) => seal_message(message, sealer),
                None => message,
            };
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
                match decode_incoming(message, opener.as_mut(), peer) {
                    Incoming::Skip => {}
                    Incoming::Closed => break,
                    Incoming::Violation(reason) => {
                        // Only the reason is logged: the frame's contents never are.
                        tracing::warn!(%peer, reason, "远程连接违反协议，已断开");
                        send_close(&outbound, CLOSE_PROTOCOL_ERROR, reason).await;
                        break;
                    }
                    Incoming::Frame(frame) => {
                        if !handle_client_frame(frame, &context, &outbound, peer).await {
                            break;
                        }
                    }
                }
            }
        }
    }

    drop(outbound);
    let _ = writer.await;
}

/// What one incoming message means to the read loop.
enum Incoming {
    /// A frame to act on.
    Frame(ClientFrame),
    /// Nothing to do; the connection carries on.
    Skip,
    /// The peer closed the connection.
    Closed,
    /// The frame broke the protocol, so the session ends. The reason reaches the peer and the log.
    Violation(&'static str),
}

/// Unwraps one incoming message, opening the session envelope when the handshake negotiated one.
fn decode_incoming(message: Message, opener: Option<&mut FrameOpener>, peer: IpAddr) -> Incoming {
    let text = match message {
        Message::Text(text) => text,
        Message::Close(_) => return Incoming::Closed,
        // Ping/Pong are answered by the WebSocket layer and binary frames carry no protocol.
        _ => return Incoming::Skip,
    };
    let Some(frame) = parse_client_frame(text.as_bytes(), peer) else {
        return Incoming::Skip;
    };
    match (frame, opener) {
        (ClientFrame::Sealed(sealed), Some(opener)) => open_sealed(sealed, opener, peer),
        // A sealed session accepts nothing else: a plaintext frame on it is either tampering or a
        // client that lost its keys, and neither is worth carrying on with.
        (_, Some(_)) => Incoming::Violation(UNSEALED_FRAME_MESSAGE),
        (ClientFrame::Sealed(_), None) => Incoming::Violation(UNEXPECTED_SEAL_MESSAGE),
        (frame, None) => Incoming::Frame(frame),
    }
}

fn open_sealed(sealed: SealedFrame, opener: &mut FrameOpener, peer: IpAddr) -> Incoming {
    let plaintext = match opener.open(&sealed) {
        Ok(plaintext) => plaintext,
        // A frame that does not open is a replay or a forgery; only the reason is ever logged.
        Err(error) => return Incoming::Violation(error.reason()),
    };
    match parse_client_frame(&plaintext, peer) {
        // A sealed frame that does not parse came from a peer holding the key, so it is version
        // skew rather than an attack and is skipped like any other unreadable frame.
        None => Incoming::Skip,
        Some(ClientFrame::Sealed(_)) => Incoming::Violation(NESTED_SEAL_MESSAGE),
        Some(frame) => Incoming::Frame(frame),
    }
}

fn parse_client_frame(payload: &[u8], peer: IpAddr) -> Option<ClientFrame> {
    match serde_json::from_slice::<ClientFrame>(payload) {
        Ok(frame) => Some(frame),
        Err(error) => {
            tracing::warn!(%peer, %error, "远程客户端发送了无法解析的帧");
            None
        }
    }
}

/// Seals one outbound frame.
///
/// A close frame passes through untouched: its code belongs to the WebSocket layer and the browser
/// has to be able to read it even when the session key is gone.
fn seal_message(message: Message, sealer: &mut FrameSealer) -> Message {
    let Message::Text(text) = &message else {
        return message;
    };
    match sealer.seal(text.as_bytes()) {
        Ok(sealed) => ServerFrame::Sealed(sealed).into_message(),
        Err(error) => {
            tracing::warn!(reason = error.reason(), "无法封装远程帧");
            Message::Close(Some(CloseFrame {
                code: CLOSE_PROTOCOL_ERROR,
                reason: Utf8Bytes::from_static("无法加密返回帧。"),
            }))
        }
    }
}

/// Returns `false` when the connection should end.
async fn handle_client_frame(
    frame: ClientFrame,
    context: &Arc<ServerContext>,
    outbound: &mpsc::Sender<Message>,
    peer: IpAddr,
) -> bool {
    match frame {
        ClientFrame::Ping => outbound
            .send(ServerFrame::Pong.into_message())
            .await
            .is_ok(),
        // Already authenticated; a repeated handshake is a no-op rather than a reason to drop.
        // An envelope never reaches here — `decode_incoming` unwrapped it.
        ClientFrame::Auth(_) | ClientFrame::Pong | ClientFrame::Sealed(_) => true,
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

/// Runs the handshake: the server speaks first with its nonce, the client answers with a proof.
///
/// The server opening the exchange is what lets the session key cover both sides' randomness, and
/// it is why the token no longer has to travel in the first frame.
async fn authenticate(
    sink: &mut SocketSink,
    stream: &mut SocketStream,
    context: &Arc<ServerContext>,
    peer: IpAddr,
    sealed_required: bool,
) -> Result<Session, ()> {
    let challenge = match HandshakeNonce::generate() {
        Ok(nonce) => nonce,
        Err(error) => {
            tracing::warn!(%peer, %error, "无法生成握手随机数");
            close_sink(sink, CLOSE_PROTOCOL_ERROR, "无法开始加密握手。").await;
            return Err(());
        }
    };
    let offer = ServerFrame::Challenge {
        protocol: PROTOCOL_VERSION,
        nonce_s: challenge.encoded.clone(),
    };
    sink.send(offer.into_message()).await.map_err(|_| ())?;

    let first = timeout(AUTH_TIMEOUT, stream.next()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        close_sink(sink, CLOSE_AUTH_TIMEOUT, "未在规定时间内完成鉴权。").await;
        return Err(());
    };
    let Ok(ClientFrame::Auth(auth)) = serde_json::from_str::<ClientFrame>(text.as_str()) else {
        reject(sink, HANDSHAKE_EXPECTED_MESSAGE).await;
        return Err(());
    };

    match choose_handshake(auth.protocol, sealed_required) {
        HandshakeChoice::Sealed => seal_session(sink, context, peer, &challenge, auth).await,
        HandshakeChoice::RefuseDowngrade => {
            tracing::warn!(%peer, "远程客户端在要求加密的连接上使用了旧握手");
            reject(sink, SEALED_REQUIRED_MESSAGE).await;
            Err(())
        }
        HandshakeChoice::Plain => {
            accept_or_reject(sink, peer, context.auth.authorize(peer, &auth.token)).await?;
            send_ready(sink, context, None).await?;
            Ok(Session {
                client_id: auth.client_id,
                sealer: None,
                opener: None,
            })
        }
    }
}

/// What the server does with one `auth` frame.
#[derive(Debug, PartialEq, Eq)]
enum HandshakeChoice {
    /// Verify the proof and seal the rest of the session.
    Sealed,
    /// Accept the token in the clear, which only the plain-http LAN route still allows.
    Plain,
    /// Refuse: this route may not fall back to the older handshake.
    RefuseDowngrade,
}

fn choose_handshake(protocol: u8, sealed_required: bool) -> HandshakeChoice {
    if protocol >= PROTOCOL_VERSION {
        return HandshakeChoice::Sealed;
    }
    if sealed_required {
        return HandshakeChoice::RefuseDowngrade;
    }
    HandshakeChoice::Plain
}

/// Completes the v2 handshake: verifies the proof and installs the two directional frame keys.
async fn seal_session(
    sink: &mut SocketSink,
    context: &Arc<ServerContext>,
    peer: IpAddr,
    challenge: &HandshakeNonce,
    auth: AuthFrame,
) -> Result<Session, ()> {
    let (Some(client_nonce), Ok(proof)) = (
        decode_nonce(&auth.nonce_c),
        BASE64URL_NOPAD.decode(auth.proof.as_bytes()),
    ) else {
        reject(sink, MALFORMED_HANDSHAKE_MESSAGE).await;
        return Err(());
    };

    // The proof is checked against the live token inside the lockout gate, exactly where a
    // plaintext token comparison used to happen, so failed guesses still lock the source address.
    let outcome = context.auth.authorize_with(peer, |token| {
        let secrets = SessionSecrets::derive(token, &challenge.bytes, &client_nonce);
        secrets
            .proof_matches(&challenge.bytes, &client_nonce, &proof)
            .then_some(secrets)
    });
    let secrets = accept_or_reject(sink, peer, outcome).await?;

    let mut sealer = secrets.sealer(Direction::ServerToClient);
    let opener = secrets.opener(Direction::ClientToServer);
    // The ready frame is the first sealed one, so opening it is how the client learns the keys
    // really do match.
    send_ready(sink, context, Some(&mut sealer)).await?;
    Ok(Session {
        client_id: auth.client_id,
        sealer: Some(sealer),
        opener: Some(opener),
    })
}

/// Turns a rejection into the refusal frame and the 4401 close, whichever handshake produced it.
async fn accept_or_reject<T>(
    sink: &mut SocketSink,
    peer: IpAddr,
    outcome: Result<T, AuthRejection>,
) -> Result<T, ()> {
    match outcome {
        Ok(accepted) => Ok(accepted),
        Err(rejection) => {
            // The token itself is never logged, only that this address failed.
            tracing::warn!(%peer, reason = rejection.reason(), "远程鉴权失败");
            reject(sink, rejection.reason()).await;
            Err(())
        }
    }
}

async fn send_ready(
    sink: &mut SocketSink,
    context: &Arc<ServerContext>,
    sealer: Option<&mut FrameSealer>,
) -> Result<(), ()> {
    let ready = ServerFrame::Ready {
        server_version: context.version.clone(),
    }
    .into_message();
    let ready = match sealer {
        Some(sealer) => seal_message(ready, sealer),
        None => ready,
    };
    sink.send(ready).await.map_err(|_| ())
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

    /// Any address will do; the frame checks never branch on it, they only log it.
    fn peer() -> IpAddr {
        "203.0.113.7".parse().expect("a valid address")
    }

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
        // A frame without `protocol` is the older handshake, which carried the token itself.
        assert!(
            matches!(auth, ClientFrame::Auth(frame) if frame.protocol == 1 && frame.token == "t" && frame.client_id == "c")
        );

        let sealed_auth = serde_json::from_str::<ClientFrame>(
            "{\"type\":\"auth\",\"protocol\":2,\"clientId\":\"c\",\"nonceC\":\"n\",\"proof\":\"p\"}",
        )
        .expect("a sealed auth frame should parse");
        assert!(matches!(
            sealed_auth,
            ClientFrame::Auth(frame)
                if frame.protocol == 2 && frame.nonce_c == "n" && frame.proof == "p"
                    && frame.token.is_empty()
        ));

        let sealed =
            serde_json::from_str::<ClientFrame>("{\"type\":\"sealed\",\"n\":7,\"c\":\"x\"}")
                .expect("a sealed frame should parse");
        assert!(matches!(sealed, ClientFrame::Sealed(frame) if frame.n == 7 && frame.c == "x"));

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

        let challenge = serde_json::to_string(&ServerFrame::Challenge {
            protocol: PROTOCOL_VERSION,
            nonce_s: "n".into(),
        })
        .expect("the frame should serialize");
        assert_eq!(
            challenge,
            "{\"type\":\"challenge\",\"protocol\":2,\"nonceS\":\"n\"}"
        );

        let sealed = serde_json::to_string(&ServerFrame::Sealed(SealedFrame {
            n: 3,
            c: "x".into(),
        }))
        .expect("the frame should serialize");
        assert_eq!(sealed, "{\"type\":\"sealed\",\"n\":3,\"c\":\"x\"}");
    }

    /// Only the plain-http LAN page keeps the older handshake, and only because the browser gives
    /// it no WebCrypto at all on that link.
    #[test]
    fn only_a_plain_http_lan_page_may_still_use_the_older_handshake() {
        assert!(requires_sealed_session(true, true));
        assert!(
            requires_sealed_session(true, false),
            "a relay hop is someone else's machine whatever it terminated in front of itself"
        );
        assert!(requires_sealed_session(false, true));
        assert!(!requires_sealed_session(false, false));
    }

    #[test]
    fn a_downgrade_is_refused_exactly_where_the_page_could_have_sealed_the_session() {
        assert_eq!(
            choose_handshake(PROTOCOL_VERSION, true),
            HandshakeChoice::Sealed
        );
        assert_eq!(
            choose_handshake(PROTOCOL_VERSION, false),
            HandshakeChoice::Sealed
        );
        assert_eq!(choose_handshake(1, true), HandshakeChoice::RefuseDowngrade);
        assert_eq!(choose_handshake(1, false), HandshakeChoice::Plain);
    }

    fn session_secrets() -> SessionSecrets {
        SessionSecrets::derive("secret", &[1_u8; 32], &[2_u8; 32])
    }

    fn sealed_text(sealer: &mut FrameSealer, plaintext: &str) -> Message {
        let frame = sealer.seal(plaintext.as_bytes()).expect("sealing succeeds");
        Message::text(
            serde_json::to_string(&ServerFrame::Sealed(frame)).expect("the frame serializes"),
        )
    }

    #[test]
    fn a_sealed_session_accepts_the_frames_inside_the_envelope() {
        let secrets = session_secrets();
        let mut client = secrets.sealer(Direction::ClientToServer);
        let mut opener = secrets.opener(Direction::ClientToServer);
        let message = sealed_text(&mut client, "{\"type\":\"ping\"}");

        assert!(matches!(
            decode_incoming(message, Some(&mut opener), peer()),
            Incoming::Frame(ClientFrame::Ping)
        ));
    }

    #[test]
    fn a_sealed_session_refuses_a_plaintext_frame_and_a_replayed_one() {
        let secrets = session_secrets();
        let mut client = secrets.sealer(Direction::ClientToServer);
        let mut opener = secrets.opener(Direction::ClientToServer);
        let first = sealed_text(&mut client, "{\"type\":\"ping\"}");
        let _ = decode_incoming(first.clone(), Some(&mut opener), peer());

        assert!(matches!(
            decode_incoming(first, Some(&mut opener), peer()),
            Incoming::Violation(_)
        ));
        assert!(matches!(
            decode_incoming(
                Message::text("{\"type\":\"ping\"}"),
                Some(&mut opener),
                peer()
            ),
            Incoming::Violation(UNSEALED_FRAME_MESSAGE)
        ));
    }

    /// An envelope that never opened cannot be nested, so the check only has to cover a peer that
    /// holds the key and wraps twice.
    #[test]
    fn an_envelope_is_refused_before_the_handshake_and_inside_another_envelope() {
        let secrets = session_secrets();
        let mut client = secrets.sealer(Direction::ClientToServer);
        let mut opener = secrets.opener(Direction::ClientToServer);
        let nested = sealed_text(&mut client, "{\"type\":\"sealed\",\"n\":0,\"c\":\"x\"}");

        assert!(matches!(
            decode_incoming(
                Message::text("{\"type\":\"sealed\",\"n\":0,\"c\":\"x\"}"),
                None,
                peer()
            ),
            Incoming::Violation(UNEXPECTED_SEAL_MESSAGE)
        ));
        assert!(matches!(
            decode_incoming(nested, Some(&mut opener), peer()),
            Incoming::Violation(NESTED_SEAL_MESSAGE)
        ));
    }

    #[test]
    fn an_outbound_frame_is_sealed_while_a_close_frame_stays_readable() {
        let secrets = session_secrets();
        let mut sealer = secrets.sealer(Direction::ServerToClient);
        let mut opener = secrets.opener(Direction::ServerToClient);

        let sealed = seal_message(ServerFrame::Resync.into_message(), &mut sealer);
        let Message::Text(text) = &sealed else {
            panic!("a text frame should stay a text frame");
        };
        let envelope = serde_json::from_str::<ClientFrame>(text.as_str())
            .expect("the envelope should parse as a sealed frame");
        let ClientFrame::Sealed(envelope) = envelope else {
            panic!("the outbound frame should be sealed");
        };
        assert_eq!(
            opener.open(&envelope).expect("the client should open it"),
            b"{\"type\":\"resync\"}"
        );

        let close = Message::Close(Some(CloseFrame {
            code: CLOSE_GOING_AWAY,
            reason: Utf8Bytes::from_static("stop"),
        }));
        assert!(matches!(
            seal_message(close, &mut sealer),
            Message::Close(Some(frame)) if frame.code == CLOSE_GOING_AWAY
        ));
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
