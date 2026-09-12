//! Shared scaffolding for the relay's integration tests: a relay in this process, a fake device on
//! the other end of a real tunnel, and a fake downstream relay that forwards streams on.
//!
//! Several test binaries include this module and each uses a different part of it, so an item that
//! looks unused here is simply one the other binary needs.
#![allow(dead_code)]

use std::future::poll_fn;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use axum::extract::ws::{Message as AxumMessage, WebSocket, WebSocketUpgrade};
use axum::extract::Request;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use hyper_util::rt::TokioIo;
use hyper_util::service::TowerToHyperService;
use termexo_relay::config::{ServeArgs, TlsMode};
use termexo_relay::db::{new_identifier, UserRole};
use termexo_relay::server;
use termexo_relay::state::SharedState;
use termexo_relay_protocol::frames::{ControlFrame, DeviceKind, RelayAddress, PROTOCOL_VERSION};
use termexo_relay_protocol::preface::{read_preface, StreamPreface};
use termexo_relay_protocol::tunnel::{ChannelByteStream, HEADER_TERMEXO_BASE};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};

/// The console account every test logs in with.
pub const TEST_ADMIN_USERNAME: &str = "tester";
pub const TEST_ADMIN_PASSWORD: &str = "relay-test-password";

const FRAME_QUEUE: usize = 128;
/// Long enough for a loaded CI machine, short enough that a hung test fails rather than stalls.
const READY_TIMEOUT: Duration = Duration::from_secs(10);
const PIPE_CAPACITY: usize = 64 * 1024;

/// A data directory that removes itself when the test ends.
pub struct TempDirectory(PathBuf);

impl TempDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "termexo-relay-test-{}",
            new_identifier()
                .expect("an identifier")
                .replace(['-', '_'], "")
        ));
        std::fs::create_dir_all(&path).expect("the data directory should be creatable");
        Self(path)
    }

    pub fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A relay running in this process on an ephemeral port.
pub struct TestRelay {
    pub address: SocketAddr,
    pub state: SharedState,
    handle: axum_server::Handle<SocketAddr>,
    _data_dir: TempDirectory,
}

impl TestRelay {
    pub async fn start() -> Self {
        let data_dir = TempDirectory::new();
        // The socket is bound before the state is built so the public URL carries the real port.
        let listener = server::bind("127.0.0.1:0".parse().expect("a valid address"))
            .expect("the listener should bind");
        let address = listener
            .local_addr()
            .expect("the listener should have an address");
        let args = ServeArgs {
            data_dir: data_dir.path().to_path_buf(),
            listen: address,
            public_url: Some(
                format!("http://{address}")
                    .parse()
                    .expect("a valid public url"),
            ),
            tls: TlsMode::Disabled,
            trusted_proxy: Vec::new(),
        };

        let state = server::prepare(&args)
            .await
            .expect("the relay should prepare");
        let hash = termexo_relay::auth::password::hash_password(TEST_ADMIN_PASSWORD)
            .expect("the password should hash");
        state
            .database
            .create_user(TEST_ADMIN_USERNAME, &hash, UserRole::Admin)
            .expect("the test administrator should be created");

        let handle = axum_server::Handle::<SocketAddr>::new();
        let serving = server::serve_on(listener, state.clone(), None, handle.clone());
        tokio::spawn(async move {
            let _ = serving.await;
        });

        let relay = Self {
            address,
            state,
            handle,
            _data_dir: data_dir,
        };
        relay.wait_until_ready().await;
        relay
    }

    pub fn origin(&self) -> String {
        format!("http://{}", self.address)
    }

    pub fn websocket_origin(&self) -> String {
        format!("ws://{}", self.address)
    }

    /// A client that keeps the console session cookie between calls.
    pub fn console_client(&self) -> reqwest::Client {
        reqwest::Client::builder()
            .cookie_store(true)
            .build()
            .expect("the client should build")
    }

    async fn wait_until_ready(&self) {
        let client = reqwest::Client::new();
        let health = format!("{}/api/health", self.origin());
        let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
        while tokio::time::Instant::now() < deadline {
            if client
                .get(&health)
                .send()
                .await
                .is_ok_and(|response| response.status().is_success())
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("中继在超时前没有就绪");
    }
}

impl Drop for TestRelay {
    fn drop(&mut self) {
        // The upstream link holds a strong reference to the state, so it has to be told to stop or
        // it would keep reconnecting to a relay the test has already finished with.
        self.state.upstream.request_stop();
        self.handle.shutdown();
    }
}

/// What a fake device reports back to the test.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceEvent {
    Welcome {
        device_id: String,
        relay_id: String,
        addresses: Vec<RelayAddress>,
        chain: Vec<String>,
    },
    /// The relay's chain changed, so the address list was pushed again.
    Addresses(Vec<RelayAddress>),
    /// One stream arrived, with the preface the relay wrote in front of it.
    Stream {
        target: String,
        hops: Vec<String>,
    },
    Revoked(String),
    Closed(Option<u16>),
}

impl DeviceEvent {
    /// The urls of an address-carrying event, which is what most assertions are about.
    pub fn urls(&self) -> Vec<String> {
        let addresses = match self {
            Self::Welcome { addresses, .. } | Self::Addresses(addresses) => addresses,
            _ => panic!("这个事件不带地址：{self:?}"),
        };
        addresses
            .iter()
            .map(|address| address.url.clone())
            .collect()
    }
}

/// How a fake tunnel peer answers the streams the relay opens.
#[derive(Clone)]
pub enum StreamHandling {
    /// Serve the request here, the way a desktop app does.
    Serve(Router),
    /// Copy the stream on to an internal device, the way a downstream relay does.
    Forward {
        device: Router,
        expected_target: String,
        expected_hops: Vec<String>,
    },
}

pub struct FakeDevice {
    pub events: mpsc::UnboundedReceiver<DeviceEvent>,
    control: mpsc::UnboundedSender<ControlFrame>,
    task: tokio::task::JoinHandle<()>,
}

impl FakeDevice {
    /// Opens a tunnel and serves whatever the relay sends through it.
    pub async fn connect(
        relay: &TestRelay,
        credential: &str,
        kind: DeviceKind,
        relay_id: Option<&str>,
        handling: StreamHandling,
    ) -> Self {
        let mut request = format!("{}/tunnel", relay.websocket_origin())
            .into_client_request()
            .expect("the handshake request should build");
        request.headers_mut().insert(
            "authorization",
            format!("Bearer {credential}")
                .parse()
                .expect("a header value"),
        );
        let (socket, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("the tunnel should upgrade");

        let (events, event_receiver) = mpsc::unbounded_channel();
        let (control, control_receiver) = mpsc::unbounded_channel();
        let hello = ControlFrame::Hello {
            protocol: PROTOCOL_VERSION,
            kind,
            version: "0.9.0-test".into(),
            name: "测试设备".into(),
            relay_id: relay_id.map(str::to_string),
        };
        let task = tokio::spawn(run_device(
            socket,
            hello,
            handling,
            events,
            control_receiver,
        ));

        Self {
            events: event_receiver,
            control,
            task,
        }
    }

    /// Drops the tunnel the way a machine that is switched off does: no close frame, just a socket
    /// that stops existing.
    pub fn power_off(&self) {
        self.task.abort();
    }

    /// Sends one control frame, which is how a fake downstream relay announces its devices.
    pub fn send(&self, frame: ControlFrame) {
        self.control
            .send(frame)
            .expect("the tunnel should accept it");
    }

    /// Waits for the next event, failing the test rather than hanging forever.
    pub async fn next_event(&mut self) -> DeviceEvent {
        tokio::time::timeout(READY_TIMEOUT, self.events.recv())
            .await
            .expect("设备事件在超时前没有到达")
            .expect("设备任务已结束")
    }

    /// Waits for the first event the predicate accepts, dropping the ones before it.
    pub async fn wait_for(&mut self, accept: impl Fn(&DeviceEvent) -> bool) -> DeviceEvent {
        loop {
            let event = self.next_event().await;
            if accept(&event) {
                return event;
            }
        }
    }
}

type TungsteniteSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn run_device(
    socket: TungsteniteSocket,
    hello: ControlFrame,
    handling: StreamHandling,
    events: mpsc::UnboundedSender<DeviceEvent>,
    mut control: mpsc::UnboundedReceiver<ControlFrame>,
) {
    let (mut sink, mut stream) = socket.split();
    sink.send(WsMessage::text(hello.encode()))
        .await
        .expect("the hello should be sent");

    let (inbound, inbound_receiver) = mpsc::channel::<Bytes>(FRAME_QUEUE);
    let (outbound, mut outbound_receiver) = mpsc::channel::<Bytes>(FRAME_QUEUE);
    let (frames, mut frame_receiver) = mpsc::unbounded_channel::<String>();

    tokio::spawn(async move {
        loop {
            let message = tokio::select! {
                data = outbound_receiver.recv() => match data {
                    Some(bytes) => WsMessage::binary(bytes),
                    None => break,
                },
                text = frame_receiver.recv() => match text {
                    Some(text) => WsMessage::text(text),
                    None => break,
                },
                frame = control.recv() => match frame {
                    Some(frame) => WsMessage::text(frame.encode()),
                    None => break,
                },
            };
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });

    let multiplexer = tokio::spawn(accept_streams(
        ChannelByteStream::new(inbound_receiver, outbound),
        handling,
        events.clone(),
    ));

    while let Some(Ok(message)) = stream.next().await {
        match message {
            WsMessage::Text(text) => {
                let Ok(frame) = ControlFrame::decode(text.as_str()) else {
                    continue;
                };
                match frame {
                    ControlFrame::Welcome {
                        device_id,
                        relay_id,
                        addresses,
                        chain,
                    } => {
                        let _ = events.send(DeviceEvent::Welcome {
                            device_id,
                            relay_id,
                            addresses,
                            chain,
                        });
                    }
                    ControlFrame::Addresses { addresses } => {
                        let _ = events.send(DeviceEvent::Addresses(addresses));
                    }
                    ControlFrame::Revoked { reason } => {
                        let _ = events.send(DeviceEvent::Revoked(reason));
                    }
                    ControlFrame::Ping => {
                        let _ = frames.send(ControlFrame::Pong.encode());
                    }
                    _ => {}
                }
            }
            WsMessage::Binary(bytes) => {
                if inbound.send(bytes).await.is_err() {
                    break;
                }
            }
            WsMessage::Close(frame) => {
                let _ = events.send(DeviceEvent::Closed(frame.map(|frame| frame.code.into())));
                break;
            }
            _ => {}
        }
    }

    multiplexer.abort();
    let _ = events.send(DeviceEvent::Closed(None));
}

/// Runs the device half of the multiplexer: the relay opens every stream, this side accepts them.
async fn accept_streams(
    transport: ChannelByteStream,
    handling: StreamHandling,
    events: mpsc::UnboundedSender<DeviceEvent>,
) {
    let mut connection = yamux::Connection::new(
        TokioAsyncReadCompatExt::compat(transport),
        yamux::Config::default(),
        yamux::Mode::Server,
    );
    while let Some(Ok(stream)) = poll_fn(|context| connection.poll_next_inbound(context)).await {
        tokio::spawn(handle_stream(
            FuturesAsyncReadCompatExt::compat(stream),
            handling.clone(),
            events.clone(),
        ));
    }
}

async fn handle_stream(
    mut stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static,
    handling: StreamHandling,
    events: mpsc::UnboundedSender<DeviceEvent>,
) {
    let preface = read_preface(&mut stream)
        .await
        .expect("the relay should write a preface");
    let _ = events.send(DeviceEvent::Stream {
        target: preface.target.clone(),
        hops: preface.hops.clone(),
    });

    match handling {
        StreamHandling::Serve(router) => serve_http(stream, router).await,
        StreamHandling::Forward {
            device,
            expected_target,
            expected_hops,
        } => {
            assert_eq!(preface.target, expected_target, "前导目标不正确");
            assert_eq!(preface.hops, expected_hops, "前导 hops 不正确");
            forward_to_internal_device(stream, device, &preface).await;
        }
    }
}

/// Serves one raw stream with an HTTP/1.1 connection, upgrades included.
async fn serve_http(stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static, router: Router) {
    let _ = hyper::server::conn::http1::Builder::new()
        .serve_connection(TokioIo::new(stream), TowerToHyperService::new(router))
        .with_upgrades()
        .await;
}

/// What a downstream relay does: copy the stream on to the next hop without parsing any HTTP.
async fn forward_to_internal_device(
    stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static,
    device: Router,
    preface: &StreamPreface,
) {
    let (relay_side, device_side) = tokio::io::duplex(PIPE_CAPACITY);
    // The next hop is the downstream relay's own device, so the preface is written on verbatim; a
    // real cascade would append its id here before handing the stream to another relay.
    let forwarded = StreamPreface {
        v: preface.v,
        target: preface.target.clone(),
        hops: preface.hops.clone(),
    };
    tokio::spawn(async move {
        let mut device_side = device_side;
        let _ = read_preface(&mut device_side).await;
        serve_http(device_side, device).await;
    });

    let mut relay_side = relay_side;
    let mut stream = stream;
    {
        use tokio::io::AsyncWriteExt;
        relay_side
            .write_all(&forwarded.encode())
            .await
            .expect("the forwarded preface should be written");
    }
    let _ = tokio::io::copy_bidirectional(&mut stream, &mut relay_side).await;
}

/// The router a fake desktop app serves: a plain resource and a WebSocket echo.
pub fn device_router() -> Router {
    Router::new()
        .route("/hello", get(hello))
        .route("/ws", get(echo_websocket))
}

/// Echoes the base header back so the test can prove the relay set it.
async fn hello(request: Request) -> String {
    let base = request
        .headers()
        .get(HEADER_TERMEXO_BASE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("<none>")
        .to_string();
    format!("设备已应答 base={base}")
}

async fn echo_websocket(upgrade: WebSocketUpgrade) -> Response {
    upgrade.on_upgrade(echo_loop)
}

async fn echo_loop(mut socket: WebSocket) {
    while let Some(Ok(message)) = socket.next().await {
        if let AxumMessage::Text(text) = message {
            if socket
                .send(AxumMessage::Text(format!("回显：{text}").into()))
                .await
                .is_err()
            {
                break;
            }
        }
    }
}

/// Logs the test administrator in and returns the client that holds the session.
pub async fn login(relay: &TestRelay) -> reqwest::Client {
    let client = relay.console_client();
    let response = client
        .post(format!("{}/api/auth/login", relay.origin()))
        .header("x-requested-with", "termexo-console")
        .json(&serde_json::json!({
            "username": TEST_ADMIN_USERNAME,
            "password": TEST_ADMIN_PASSWORD,
        }))
        .send()
        .await
        .expect("the login should reach the relay");
    assert_eq!(response.status(), reqwest::StatusCode::OK, "登录应当成功");
    client
}

/// Issues an enrollment code of the requested kind and returns it.
pub async fn issue_code(relay: &TestRelay, client: &reqwest::Client, kind: &str) -> String {
    let response = client
        .post(format!("{}/api/admin/enrollments", relay.origin()))
        .header("x-requested-with", "termexo-console")
        .json(&serde_json::json!({ "kind": kind }))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(response.status(), reqwest::StatusCode::CREATED);
    let body: serde_json::Value = response.json().await.expect("a JSON body");
    body["code"]
        .as_str()
        .expect("the response should carry the code")
        .to_string()
}

/// Trades an enrollment code for a device credential.
pub async fn enroll(relay: &TestRelay, code: &str, name: &str) -> (String, String) {
    let response = reqwest::Client::new()
        .post(format!("{}/api/enroll", relay.origin()))
        .json(&serde_json::json!({ "method": "code", "code": code, "name": name }))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(response.status(), reqwest::StatusCode::CREATED);
    let body: serde_json::Value = response.json().await.expect("a JSON body");
    (
        body["credential"]
            .as_str()
            .expect("a credential")
            .to_string(),
        body["deviceId"].as_str().expect("a device id").to_string(),
    )
}

/// Wraps a shared registry snapshot lookup the tests use to wait for a device to come online.
pub async fn wait_until_online(relay: &TestRelay, device_id: &str) {
    wait_until(READY_TIMEOUT, || relay.state.registry.is_online(device_id))
        .await
        .unwrap_or_else(|| panic!("设备 {device_id} 在超时前没有上线"));
}

pub async fn wait_until_offline(relay: &TestRelay, device_id: &str) {
    wait_until(READY_TIMEOUT, || !relay.state.registry.is_online(device_id))
        .await
        .unwrap_or_else(|| panic!("设备 {device_id} 在超时前没有下线"));
}

/// Polls a condition until it holds, which is how a test waits on something that travels a tunnel.
async fn wait_until(within: Duration, mut ready: impl FnMut() -> bool) -> Option<()> {
    let deadline = tokio::time::Instant::now() + within;
    while tokio::time::Instant::now() < deadline {
        if ready() {
            return Some(());
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    None
}

/// Points one relay at another, the way the console's relay page does.
pub async fn join_upstream(
    downstream: &TestRelay,
    console: &reqwest::Client,
    upstream: &TestRelay,
    code: &str,
) -> reqwest::Response {
    console
        .post(format!("{}/api/admin/relays/upstream", downstream.origin()))
        .header("x-requested-with", "termexo-console")
        .json(&serde_json::json!({ "url": upstream.origin(), "code": code }))
        .send()
        .await
        .expect("the request should reach the relay")
}

pub async fn leave_upstream(relay: &TestRelay, console: &reqwest::Client) -> reqwest::Response {
    console
        .delete(format!("{}/api/admin/relays/upstream", relay.origin()))
        .header("x-requested-with", "termexo-console")
        .send()
        .await
        .expect("the request should reach the relay")
}

/// `GET /api/admin/relays`, which is what the console's relay page renders.
pub async fn relay_overview(relay: &TestRelay, console: &reqwest::Client) -> serde_json::Value {
    console
        .get(format!("{}/api/admin/relays", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay")
        .json()
        .await
        .expect("a JSON body")
}

/// Waits until the upstream link reports the state the test is after, and returns its view.
pub async fn wait_for_upstream_state(
    relay: &TestRelay,
    console: &reqwest::Client,
    expected: &str,
) -> serde_json::Value {
    let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
    let mut last = serde_json::Value::Null;
    while tokio::time::Instant::now() < deadline {
        last = relay_overview(relay, console).await["upstream"].clone();
        if last["state"] == expected {
            return last;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("上游状态在超时前没有变成 {expected}，最后一次是 {last}");
}

/// `GET /api/admin/devices`, as the console's device table sees it.
pub async fn admin_devices(relay: &TestRelay, console: &reqwest::Client) -> Vec<serde_json::Value> {
    let body: serde_json::Value = console
        .get(format!("{}/api/admin/devices", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay")
        .json()
        .await
        .expect("a JSON body");
    body["devices"]
        .as_array()
        .expect("an array of devices")
        .clone()
}

/// Whether an audit action was recorded, which is how the cascade tests check a refusal.
pub fn audited(relay: &TestRelay, action: &str) -> bool {
    relay
        .state
        .database
        .list_audit(&termexo_relay::db::AuditQuery {
            limit: 100,
            ..termexo_relay::db::AuditQuery::default()
        })
        .expect("the audit list should work")
        .into_iter()
        .any(|event| event.action == action)
}
