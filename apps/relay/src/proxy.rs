//! The public reverse proxy: `/d/<deviceId>/…` on the outside, one stream inside a tunnel on the
//! inside.
//!
//! The relay does not understand Termexo's protocol. It rewrites the URI, sets the forwarding
//! headers and copies bytes; every stream is a plain HTTP/1.1 connection that the device serves
//! with its own router.

use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::body::Body;
use axum::extract::Request;
use axum::http::{
    header, HeaderMap, HeaderName, HeaderValue, Response as HttpResponse, StatusCode, Uri,
};
use axum::response::{IntoResponse, Response};
use http_body_util::Limited;
use hyper::rt::{Read, ReadBufCursor, Write};
use hyper_util::client::legacy::connect::{Connected, Connection};
use hyper_util::client::legacy::Client;
use hyper_util::rt::{TokioExecutor, TokioIo};
use termexo_relay_protocol::preface::StreamPreface;
use termexo_relay_protocol::tunnel::{
    DEVICE_PATH_PREFIX, HEADER_FORWARDED_FOR, HEADER_FORWARDED_HOST, HEADER_FORWARDED_PROTO,
    HEADER_TERMEXO_BASE,
};
use tower::Service;

use crate::forwarded::ClientContext;
use crate::registry::{Registry, Route};
use crate::state::RelayState;
use crate::tunnel::{TunnelError, TunnelStream};

/// The authority the proxy addresses a device by. It is never resolved through DNS: the connector
/// reads the device id back out of it, which is also what makes hyper's connection pool group
/// keep-alive connections per device for free.
const TUNNEL_AUTHORITY_SUFFIX: &str = ".termexo-tunnel";

/// Largest request body the relay carries. The workbench only receives data on its WebSocket, so
/// anything larger is a mistake rather than a use case.
const MAX_REQUEST_BODY_BYTES: usize = 1024 * 1024;

/// Headers that describe one hop of a connection and must not be forwarded onto the next one.
const HOP_BY_HOP_HEADERS: [&str; 8] = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

const WEBSOCKET_UPGRADE: &str = "websocket";

type ProxyBody = Limited<Body>;
type ProxyClient = Client<TunnelConnector, ProxyBody>;

/// Holds the pooled client and the connector that opens tunnel streams for it.
pub struct Proxy {
    connector: TunnelConnector,
    client: ProxyClient,
}

impl Proxy {
    pub fn new(registry: Arc<Registry>, relay_id: &str) -> Self {
        let connector = TunnelConnector {
            registry,
            relay_id: Arc::from(relay_id),
        };
        Self {
            client: Client::builder(TokioExecutor::new()).build(connector.clone()),
            connector,
        }
    }
}

/// Splits `/d/<deviceId>/<rest>` into its two parts, or reports that this is not a device path.
///
/// Returns `None` for the device id when the path is exactly `/d/<deviceId>` without the trailing
/// slash, which the caller answers with a redirect: relative asset URLs in the workbench only
/// resolve correctly under a directory-shaped base.
pub enum DevicePath {
    /// `/d/<deviceId>` — needs the trailing slash before anything can be served.
    NeedsSlash { device_id: String },
    /// `/d/<deviceId>/<rest>`, with `rest` never starting with a slash.
    Resource { device_id: String, rest: String },
}

pub fn parse_device_path(path: &str) -> Option<DevicePath> {
    let remainder = path.strip_prefix(DEVICE_PATH_PREFIX)?;
    match remainder.split_once('/') {
        Some((device_id, rest)) if !device_id.is_empty() => Some(DevicePath::Resource {
            device_id: device_id.to_string(),
            rest: rest.to_string(),
        }),
        Some(_) => None,
        None if remainder.is_empty() => None,
        None => Some(DevicePath::NeedsSlash {
            device_id: remainder.to_string(),
        }),
    }
}

/// Forwards one browser request to its device.
pub async fn forward(
    state: &RelayState,
    client: &ClientContext,
    device_id: &str,
    rest: &str,
    request: Request,
) -> Response {
    let device = match state.database.find_device(device_id) {
        Ok(device) => device,
        Err(error) => return internal_error(&error),
    };
    if !state.registry.is_online(device_id) {
        return unreachable_page(state, device_id, device);
    }

    let base = format!("{DEVICE_PATH_PREFIX}{device_id}/");
    let (mut parts, body) = request.into_parts();
    let target = match tunnel_uri(device_id, rest, parts.uri.query()) {
        Some(uri) => uri,
        None => return (StatusCode::BAD_REQUEST, "请求路径无效。").into_response(),
    };
    let websocket = is_websocket_upgrade(&parts.headers);
    prepare_request_headers(&mut parts.headers, client, &base, websocket);
    parts.uri = target;

    if websocket {
        return bridge_websocket(&state.proxy, parts, body).await;
    }
    let outbound = hyper::Request::from_parts(parts, Limited::new(body, MAX_REQUEST_BODY_BYTES));
    match state.proxy.client.request(outbound).await {
        Ok(response) => relay_response(response.map(Body::new)),
        Err(error) => {
            tracing::debug!(device = %device_id, %error, "转发到设备失败");
            offline_page(device_id, None)
        }
    }
}

/// The page for a device the relay cannot open a stream to right now.
///
/// A device this relay enrolled itself always has a row, so it can be named. One that a downstream
/// relay announced has none, and is named from what the routing table remembers of it — without
/// that, an address that worked a minute ago would read as "no such device".
fn unreachable_page(
    state: &RelayState,
    device_id: &str,
    record: Option<crate::db::DeviceRecord>,
) -> Response {
    if let Some(record) = record {
        return offline_page(&record.name, record.last_seen_at);
    }
    match state.registry.last_known(device_id) {
        Some(known) => offline_page(&known.name, Some(known.last_seen_at)),
        None => unknown_device_page(),
    }
}

/// Answers `/d/<deviceId>` with a redirect to `/d/<deviceId>/`.
pub fn redirect_to_directory(device_id: &str) -> Response {
    let location = format!("{DEVICE_PATH_PREFIX}{device_id}/");
    match HeaderValue::from_str(&location) {
        Ok(value) => (StatusCode::FOUND, [(header::LOCATION, value)]).into_response(),
        Err(_) => unknown_device_page(),
    }
}

/// Runs a WebSocket through the tunnel by upgrading both sides and copying between them.
///
/// This path bypasses the pooled client on purpose: an upgraded connection is never reusable, so
/// handing it to the pool would only complicate its bookkeeping for no gain.
async fn bridge_websocket(
    proxy: &Proxy,
    parts: hyper::http::request::Parts,
    body: Body,
) -> Response {
    // Taking the upgrade out of the browser's request has to happen before the request is turned
    // back into its pieces, and it is what lets the server hand the socket over once it answers 101.
    let mut browser_request = hyper::Request::from_parts(parts, body);
    let browser_upgrade = hyper::upgrade::on(&mut browser_request);
    let (parts, _) = browser_request.into_parts();
    let device_id = authority_device_id(&parts.uri).unwrap_or_default();

    let mut connector = proxy.connector.clone();
    let stream = match connector.call(parts.uri.clone()).await {
        Ok(stream) => stream,
        Err(error) => {
            tracing::debug!(%error, "无法为 WebSocket 打开隧道流");
            return offline_page(&device_id, None);
        }
    };
    let (mut sender, connection) = match hyper::client::conn::http1::handshake(stream).await {
        Ok(pair) => pair,
        Err(error) => return bad_gateway(&error),
    };
    tokio::spawn(async move {
        if let Err(error) = connection.with_upgrades().await {
            tracing::debug!(%error, "设备侧 WebSocket 连接结束");
        }
    });

    let mut device_response = match sender
        .send_request(hyper::Request::from_parts(parts, Body::empty()))
        .await
    {
        Ok(response) => response,
        Err(error) => return bad_gateway(&error),
    };
    if device_response.status() != StatusCode::SWITCHING_PROTOCOLS {
        return relay_response(device_response.map(Body::new));
    }

    let device_upgrade = hyper::upgrade::on(&mut device_response);
    tokio::spawn(async move {
        match tokio::try_join!(browser_upgrade, device_upgrade) {
            Ok((browser, device)) => {
                let mut browser = TokioIo::new(browser);
                let mut device = TokioIo::new(device);
                if let Err(error) = tokio::io::copy_bidirectional(&mut browser, &mut device).await {
                    tracing::debug!(%error, "WebSocket 对拷结束");
                }
            }
            Err(error) => tracing::debug!(%error, "WebSocket 升级未完成"),
        }
    });
    relay_response(device_response.map(|_| Body::empty()))
}

/// Rewrites the request URI into the tunnel's addressing scheme.
fn tunnel_uri(device_id: &str, rest: &str, query: Option<&str>) -> Option<Uri> {
    let path_and_query = match query {
        Some(query) => format!("/{rest}?{query}"),
        None => format!("/{rest}"),
    };
    Uri::builder()
        .scheme("http")
        .authority(format!("{device_id}{TUNNEL_AUTHORITY_SUFFIX}"))
        .path_and_query(path_and_query)
        .build()
        .ok()
}

fn authority_device_id(uri: &Uri) -> Option<String> {
    uri.authority()
        .and_then(|authority| authority.host().strip_suffix(TUNNEL_AUTHORITY_SUFFIX))
        .map(str::to_string)
}

/// Prepares the headers the device sees: hop-by-hop entries removed, forwarding entries added.
fn prepare_request_headers(
    headers: &mut HeaderMap,
    client: &ClientContext,
    base: &str,
    websocket: bool,
) {
    strip_hop_by_hop(headers, websocket);
    // hyper fills `Host` from the tunnel authority; the browser's own host travels in
    // `X-Forwarded-Host`, which is what the device compares an `Origin` against.
    headers.remove(header::HOST);
    set_header(headers, HEADER_FORWARDED_FOR, &client.ip.to_string());
    set_header(headers, HEADER_FORWARDED_PROTO, &client.proto);
    set_header(headers, HEADER_FORWARDED_HOST, &client.host);
    set_header(headers, HEADER_TERMEXO_BASE, base);
}

/// Passes a device's response back to the browser with its hop-by-hop headers removed.
fn relay_response(mut response: HttpResponse<Body>) -> Response {
    let upgrading = response.status() == StatusCode::SWITCHING_PROTOCOLS;
    strip_hop_by_hop(response.headers_mut(), upgrading);
    response
}

/// Removes the headers that belong to one hop only.
///
/// `Connection` names further headers that are hop-by-hop for this message, so those are collected
/// before anything is removed. An upgrade keeps `connection` and `upgrade`: they are exactly what
/// tells the other end that the protocol is changing.
fn strip_hop_by_hop(headers: &mut HeaderMap, keep_upgrade: bool) {
    let listed: Vec<HeaderName> = headers
        .get(header::CONNECTION)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .filter_map(|name| HeaderName::try_from(name.trim()).ok())
                .collect()
        })
        .unwrap_or_default();

    for name in HOP_BY_HOP_HEADERS
        .iter()
        .filter_map(|name| HeaderName::try_from(*name).ok())
        .chain(listed)
    {
        if keep_upgrade && (name == header::CONNECTION || name == header::UPGRADE) {
            continue;
        }
        headers.remove(&name);
    }
}

fn is_websocket_upgrade(headers: &HeaderMap) -> bool {
    headers
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case(WEBSOCKET_UPGRADE))
}

fn set_header(headers: &mut HeaderMap, name: &'static str, value: &str) {
    match HeaderValue::from_str(value) {
        Ok(value) => {
            headers.insert(HeaderName::from_static(name), value);
        }
        // A value that cannot be a header is a value the device is better off not seeing at all.
        Err(_) => {
            headers.remove(name);
        }
    }
}

fn internal_error(error: &impl std::fmt::Display) -> Response {
    tracing::error!(%error, "查询设备记录失败");
    (StatusCode::INTERNAL_SERVER_ERROR, "中继内部错误。").into_response()
}

fn bad_gateway(error: &impl std::fmt::Display) -> Response {
    tracing::debug!(%error, "设备连接失败");
    (StatusCode::BAD_GATEWAY, "设备连接失败。").into_response()
}

fn unknown_device_page() -> Response {
    html_page(
        StatusCode::NOT_FOUND,
        "设备不存在",
        "<p>这个地址没有对应的设备。请确认链接是否完整。</p>".to_string(),
    )
}

/// The page a browser gets when the device is not connected right now.
fn offline_page(name: &str, last_seen_at: Option<i64>) -> Response {
    let body = format!(
        "<p><strong>{}</strong> 当前没有连接到中继。</p><p>最近在线：{}</p>\
         <p>请确认这台电脑已开机，并且 Termexo 的中继接入处于开启状态。</p>",
        escape_html(name),
        describe_last_seen(last_seen_at, crate::db::now_millis())
    );
    html_page(StatusCode::SERVICE_UNAVAILABLE, "设备离线", body)
}

fn html_page(status: StatusCode, title: &str, body: String) -> Response {
    let document = format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <title>{title}</title><style>body{{margin:0;min-height:100vh;display:grid;\
         place-items:center;background:#10151c;color:#e6edf3;font-family:system-ui,\
         \"Segoe UI\",\"Microsoft YaHei\",sans-serif}}main{{max-width:32rem;padding:2rem;\
         text-align:center;line-height:1.7}}</style></head><body><main><h1>{title}</h1>\
         {body}</main></body></html>"
    );
    (
        status,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        document,
    )
        .into_response()
}

/// Describes how long ago a device was last seen, in Chinese and without a date library.
///
/// A relative description is also the more useful one here: the person reading it wants to know
/// whether the machine just dropped off or has been gone for a week.
fn describe_last_seen(last_seen_at: Option<i64>, now: i64) -> String {
    const MINUTE: i64 = 60 * 1000;
    const HOUR: i64 = 60 * MINUTE;
    const DAY: i64 = 24 * HOUR;

    let Some(last_seen_at) = last_seen_at else {
        return "从未接入".to_string();
    };
    let elapsed = (now - last_seen_at).max(0);
    if elapsed < MINUTE {
        return "刚刚".to_string();
    }
    if elapsed < HOUR {
        return format!("{} 分钟前", elapsed / MINUTE);
    }
    if elapsed < DAY {
        return format!("{} 小时前", elapsed / HOUR);
    }
    format!("{} 天前", elapsed / DAY)
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Opens one tunnel stream per connection hyper asks for.
#[derive(Clone)]
struct TunnelConnector {
    registry: Arc<Registry>,
    relay_id: Arc<str>,
}

impl Service<Uri> for TunnelConnector {
    type Response = TunnelIo;
    type Error = TunnelError;
    type Future = Pin<Box<dyn Future<Output = Result<TunnelIo, TunnelError>> + Send>>;

    fn poll_ready(&mut self, _context: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, uri: Uri) -> Self::Future {
        let registry = self.registry.clone();
        let relay_id = self.relay_id.clone();
        Box::pin(async move {
            let device_id = authority_device_id(&uri).ok_or(TunnelError::InvalidTarget)?;
            let route = registry.route(&device_id).ok_or(TunnelError::Offline)?;
            let preface = stream_preface(&route, &device_id, &relay_id);
            Ok(TunnelIo(TokioIo::new(
                route.link().open_stream(&preface).await?,
            )))
        })
    }
}

/// Builds the preface for one stream.
///
/// A directly attached device gets an empty hop list; a device behind a downstream relay gets this
/// relay's id, which is what the downstream appends to as it forwards.
fn stream_preface(route: &Route, device_id: &str, relay_id: &str) -> StreamPreface {
    match route {
        Route::Direct(_) => StreamPreface::new(device_id),
        Route::Via { .. } => StreamPreface::new(device_id).with_hop(relay_id),
    }
}

/// One tunnel stream in the shape hyper's client expects.
///
/// The wrapper exists for `Connection`: hyper's pool needs it, and it cannot be implemented on the
/// foreign `TokioIo` type.
pub struct TunnelIo(TokioIo<TunnelStream>);

impl Connection for TunnelIo {
    fn connected(&self) -> Connected {
        // Not proxied in HTTP's sense: the far end serves the request itself.
        Connected::new()
    }
}

impl Read for TunnelIo {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: ReadBufCursor<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_read(context, buffer)
    }
}

impl Write for TunnelIo {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.0).poll_write(context, data)
    }

    fn poll_flush(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_flush(context)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_shutdown(context)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tunnel::TunnelHandle;

    #[test]
    fn a_device_path_splits_into_an_id_and_the_rest() {
        assert!(matches!(
            parse_device_path("/d/abc/index.html"),
            Some(DevicePath::Resource { device_id, rest }) if device_id == "abc" && rest == "index.html"
        ));
        assert!(matches!(
            parse_device_path("/d/abc/"),
            Some(DevicePath::Resource { device_id, rest }) if device_id == "abc" && rest.is_empty()
        ));
        assert!(matches!(
            parse_device_path("/d/abc"),
            Some(DevicePath::NeedsSlash { device_id }) if device_id == "abc"
        ));
        assert!(matches!(
            parse_device_path("/d/abc/assets/main.js"),
            Some(DevicePath::Resource { rest, .. }) if rest == "assets/main.js"
        ));
    }

    #[test]
    fn a_path_that_is_not_a_device_address_is_refused() {
        assert!(parse_device_path("/console/").is_none());
        assert!(parse_device_path("/d/").is_none());
        assert!(parse_device_path("/d//index.html").is_none());
    }

    #[test]
    fn the_tunnel_uri_carries_the_device_id_and_keeps_the_query() {
        let uri = tunnel_uri("abc", "ws", Some("token=1")).expect("the uri should build");

        assert_eq!(uri.to_string(), "http://abc.termexo-tunnel/ws?token=1");
        assert_eq!(authority_device_id(&uri).as_deref(), Some("abc"));
        assert_eq!(
            tunnel_uri("abc", "", None)
                .expect("the uri should build")
                .path(),
            "/"
        );
    }

    #[test]
    fn hop_by_hop_headers_are_removed_including_the_ones_connection_names() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONNECTION,
            HeaderValue::from_static("keep-alive, x-hop"),
        );
        headers.insert("keep-alive", HeaderValue::from_static("timeout=5"));
        headers.insert("x-hop", HeaderValue::from_static("private"));
        headers.insert("transfer-encoding", HeaderValue::from_static("chunked"));
        headers.insert(header::ACCEPT, HeaderValue::from_static("text/html"));

        strip_hop_by_hop(&mut headers, false);

        assert!(headers.get(header::CONNECTION).is_none());
        assert!(headers.get("keep-alive").is_none());
        assert!(headers.get("x-hop").is_none());
        assert!(headers.get("transfer-encoding").is_none());
        assert_eq!(
            headers.get(header::ACCEPT).expect("it should survive"),
            "text/html"
        );
    }

    #[test]
    fn an_upgrade_keeps_the_headers_that_describe_it() {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONNECTION, HeaderValue::from_static("Upgrade"));
        headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
        headers.insert("transfer-encoding", HeaderValue::from_static("chunked"));

        strip_hop_by_hop(&mut headers, true);

        assert_eq!(headers.get(header::UPGRADE).expect("kept"), "websocket");
        assert_eq!(headers.get(header::CONNECTION).expect("kept"), "Upgrade");
        assert!(headers.get("transfer-encoding").is_none());
    }

    #[test]
    fn forwarding_headers_replace_whatever_the_browser_sent() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static("relay.example.com"));
        headers.insert(HEADER_FORWARDED_FOR, HeaderValue::from_static("10.0.0.9"));
        let client = ClientContext {
            ip: "203.0.113.5".parse().expect("an address"),
            proto: "https".into(),
            host: "relay.example.com".into(),
        };

        prepare_request_headers(&mut headers, &client, "/d/abc/", false);

        assert!(headers.get(header::HOST).is_none());
        assert_eq!(
            headers.get(HEADER_FORWARDED_FOR).expect("set"),
            "203.0.113.5"
        );
        assert_eq!(headers.get(HEADER_FORWARDED_PROTO).expect("set"), "https");
        assert_eq!(
            headers.get(HEADER_FORWARDED_HOST).expect("set"),
            "relay.example.com"
        );
        assert_eq!(headers.get(HEADER_TERMEXO_BASE).expect("set"), "/d/abc/");
    }

    #[test]
    fn a_websocket_request_is_recognised_case_insensitively() {
        let mut headers = HeaderMap::new();
        headers.insert(header::UPGRADE, HeaderValue::from_static("WebSocket"));
        assert!(is_websocket_upgrade(&headers));

        headers.insert(header::UPGRADE, HeaderValue::from_static("h2c"));
        assert!(!is_websocket_upgrade(&headers));
        assert!(!is_websocket_upgrade(&HeaderMap::new()));
    }

    #[test]
    fn only_a_route_through_a_downstream_relay_carries_a_hop() {
        let handle = TunnelHandle::disconnected("device-a");
        let direct = stream_preface(&Route::Direct(handle.clone()), "device-a", "relay-a");
        let via = stream_preface(
            &Route::Via {
                link: handle,
                hops: vec!["relay-b".into()],
            },
            "device-a",
            "relay-a",
        );

        assert!(direct.hops.is_empty());
        assert_eq!(direct.target, "device-a");
        assert_eq!(via.hops, vec!["relay-a".to_string()]);
    }

    #[test]
    fn the_last_seen_description_reads_naturally_in_every_range() {
        let now = 10_000_000_000;

        assert_eq!(describe_last_seen(None, now), "从未接入");
        assert_eq!(describe_last_seen(Some(now - 1_000), now), "刚刚");
        assert_eq!(describe_last_seen(Some(now - 5 * 60_000), now), "5 分钟前");
        assert_eq!(
            describe_last_seen(Some(now - 3 * 3_600_000), now),
            "3 小时前"
        );
        assert_eq!(
            describe_last_seen(Some(now - 2 * 86_400_000), now),
            "2 天前"
        );
        // A clock that moved backwards must not produce a negative age.
        assert_eq!(describe_last_seen(Some(now + 60_000), now), "刚刚");
    }

    #[test]
    fn a_device_name_cannot_inject_markup_into_the_offline_page() {
        assert_eq!(
            escape_html("<script>alert(\"x\")</script>&"),
            "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;"
        );
    }
}
