//! Assembling the HTTP surface and running the listener.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use axum_server::tls_rustls::RustlsConfig;
use termexo_relay_protocol::tunnel::TUNNEL_PATH;

use crate::address::{DeviceAddressing, DeviceEntry, DeviceTarget};
use crate::auth::LockoutTable;
use crate::bootstrap;
use crate::config::ServeArgs;
use crate::console;
use crate::db::{now_millis, Database, SETTING_PUBLIC_URL, SETTING_RELAY_ID};
use crate::forwarded;
use crate::proxy::{self, DevicePath};
use crate::registry::Registry;
use crate::state::{RelayState, SharedState, RELAY_VERSION};
use crate::tls;
use crate::tunnel;
use crate::upstream::{self, UpstreamLink};

/// A relay id is short, lowercase and free of URL-escaping, exactly like a device id: it travels in
/// announcements, prefaces and address lists.
fn generate_relay_id() -> Result<String, crate::db::DatabaseError> {
    termexo_relay_protocol::credential::DeviceId::generate()
        .map(|id| id.to_string())
        .map_err(|error| crate::db::DatabaseError::Random(error.to_string()))
}

/// Opens the data directory, prepares the state and serves until the process is asked to stop.
pub async fn serve(args: ServeArgs) -> Result<(), String> {
    let state = prepare(&args).await?;
    let public_url = state.public_url().clone();
    let tls = tls::configure(
        &args.tls,
        &args.data_dir,
        &tls::SubjectNames {
            public_host: public_url.host_name().to_string(),
            wildcard: state.addressing.wildcard_name(),
        },
    )
    .await?;
    let listener = bind(args.listen)?;
    let handle = axum_server::Handle::<SocketAddr>::new();
    tokio::spawn(shut_down_on_signal(handle.clone()));

    tracing::info!(
        listen = %args.listen,
        public_url = %public_url,
        subdomain_base = args.subdomain_base.as_ref().map(ToString::to_string),
        version = RELAY_VERSION,
        tls = args.tls.is_secure(),
        "Termexo 中继已启动"
    );
    serve_on(listener, state, tls, handle).await
}

/// Binds the listening socket.
///
/// Done synchronously and before anything is spawned, so "port already in use" is an immediate,
/// reportable error rather than a task that dies in the background.
pub fn bind(address: SocketAddr) -> Result<std::net::TcpListener, String> {
    let listener = std::net::TcpListener::bind(address)
        .map_err(|error| format!("无法监听 {address}：{error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("无法配置监听套接字：{error}"))?;
    Ok(listener)
}

/// Serves on an already-bound socket, which is what lets a test take an ephemeral port without
/// racing another process for it between the probe and the bind.
pub async fn serve_on(
    listener: std::net::TcpListener,
    state: SharedState,
    tls: Option<RustlsConfig>,
    handle: axum_server::Handle<SocketAddr>,
) -> Result<(), String> {
    let service = router(state).into_make_service_with_connect_info::<SocketAddr>();
    let result = match tls {
        Some(config) => {
            axum_server::tls_rustls::from_tcp_rustls(listener, config)
                .map_err(|error| format!("无法启动 HTTPS 服务：{error}"))?
                .handle(handle)
                .serve(service)
                .await
        }
        None => {
            axum_server::from_tcp(listener)
                .map_err(|error| format!("无法启动 HTTP 服务：{error}"))?
                .handle(handle)
                .serve(service)
                .await
        }
    };
    result.map_err(|error| format!("中继服务异常退出：{error}"))
}

/// Opens the database and builds the state every handler shares.
pub async fn prepare(args: &ServeArgs) -> Result<SharedState, String> {
    std::fs::create_dir_all(&args.data_dir)
        .map_err(|error| format!("无法创建数据目录 {}：{error}", args.data_dir.display()))?;
    let database =
        Database::open(&args.data_dir).map_err(|error| format!("无法打开中继数据库：{error}"))?;

    // Sessions that ran out are swept once per start; nothing will ever present them again.
    if let Err(error) = database.delete_expired_sessions(now_millis()) {
        tracing::warn!(%error, "清理过期控制台会话失败");
    }

    let relay_id = database
        .read_or_initialize_setting(SETTING_RELAY_ID, generate_relay_id)
        .map_err(|error| format!("无法确定中继标识：{error}"))?;
    let public_url = args.resolved_public_url();
    if let Err(error) = database.write_setting(SETTING_PUBLIC_URL, public_url.origin()) {
        tracing::warn!(%error, "无法保存公开地址");
    }
    bootstrap::ensure_admin_exists(&database)?;

    install_crypto_provider();
    let registry = Arc::new(Registry::new(relay_id.clone()));
    let state = Arc::new(RelayState {
        proxy: proxy::Proxy::new(registry.clone(), &relay_id),
        registry,
        upstream: Arc::new(UpstreamLink::new()),
        database,
        lockout: LockoutTable::new(),
        relay_id,
        addressing: DeviceAddressing::new(public_url, args.subdomain_base.clone()),
        trusted_proxies: args.trusted_proxy.clone(),
        tls_enabled: args.tls.is_secure(),
    });
    // A stored upstream is dialled before the listener opens, so a relay that restarts is back in
    // its chain by the time the first browser arrives.
    upstream::resume(&state).await;
    Ok(state)
}

/// The complete routing table.
///
/// The subdomain layer sits outside every route: on `<deviceId>.<base>` the whole host belongs to
/// that device, `/` and `/api/…` included, so the decision has to be made before a route can claim
/// a path the device serves itself.
pub fn router(state: SharedState) -> Router {
    crate::api::router()
        .route(TUNNEL_PATH, get(tunnel::upgrade))
        .route("/", get(root))
        .fallback(dispatch)
        .layer(axum::middleware::from_fn(crate::api::require_csrf_marker))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            route_device_host,
        ))
        .with_state(state)
}

async fn root() -> Response {
    console::redirect_to_console()
}

/// Sends a request that arrived on a device subdomain to that device, untouched.
async fn route_device_host(
    State(state): State<SharedState>,
    request: Request,
    next: Next,
) -> Response {
    let Some(device_id) =
        host_header(&request).and_then(|host| state.addressing.device_from_host(host))
    else {
        return next.run(request).await;
    };
    let rest = request.uri().path().trim_start_matches('/').to_string();
    forward_to_device(
        &state,
        DeviceTarget {
            device_id,
            rest,
            entry: DeviceEntry::Subdomain,
        },
        request,
    )
    .await
}

fn host_header(request: &Request) -> Option<&str> {
    request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
}

/// Everything the routing table did not claim: device addresses, console assets, and 404s.
///
/// The device prefix is handled here rather than as a route because `/d/<id>`, `/d/<id>/` and
/// `/d/<id>/<rest>` are three shapes of the same address, and splitting the path once is clearer
/// than three overlapping patterns. It stays available in subdomain mode: a link that was handed
/// out before the operator configured a wildcard domain has to keep working.
async fn dispatch(State(state): State<SharedState>, request: Request) -> Response {
    let path = request.uri().path().to_string();
    if path.starts_with("/api/") {
        return crate::api::unknown_endpoint();
    }
    match proxy::parse_device_path(&path) {
        Some(DevicePath::NeedsSlash { device_id }) => {
            return proxy::redirect_to_directory(&device_id)
        }
        Some(DevicePath::Resource { device_id, rest }) => {
            return forward_to_device(
                &state,
                DeviceTarget {
                    device_id,
                    rest,
                    entry: DeviceEntry::Path,
                },
                request,
            )
            .await
        }
        None => {}
    }
    if path.starts_with(console::CONSOLE_PATH_PREFIX) {
        return console::serve(&path);
    }
    (StatusCode::NOT_FOUND, "页面不存在。").into_response()
}

/// The one place a browser request turns into a proxied one, whichever entry it arrived on.
async fn forward_to_device(
    state: &SharedState,
    target: DeviceTarget,
    request: Request,
) -> Response {
    let Some(ConnectInfo(peer)) = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .copied()
    else {
        tracing::error!("请求缺少连接信息，无法确定来源地址");
        return (StatusCode::INTERNAL_SERVER_ERROR, "中继内部错误。").into_response();
    };
    let client = forwarded::resolve(state, request.headers(), peer);
    proxy::forward(state, &client, &target, request).await
}

/// rustls needs a provider installed before any TLS work; the desktop app picks the same one, so a
/// certificate generated by one is usable by the other.
fn install_crypto_provider() {
    // An error only means another part of the process already installed it, which is the outcome
    // this call is after anyway.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

async fn shut_down_on_signal(handle: axum_server::Handle<SocketAddr>) {
    if tokio::signal::ctrl_c().await.is_ok() {
        tracing::info!("收到停止信号，正在关闭中继");
        handle.graceful_shutdown(Some(SHUTDOWN_GRACE));
    }
}

/// How long in-flight requests get before the listener is torn down anyway.
const SHUTDOWN_GRACE: std::time::Duration = std::time::Duration::from_secs(5);
