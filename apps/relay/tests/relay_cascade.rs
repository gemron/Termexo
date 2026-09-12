//! Cascading, end to end: two real relays in this process, a real tunnel between them, and a fake
//! desktop on the far end. Everything a browser does here crosses both relays.

mod support;

use futures_util::{SinkExt, StreamExt};
use support::{
    admin_devices, audited, device_router, enroll, issue_code, join_upstream, leave_upstream,
    login, relay_overview, wait_for_upstream_state, wait_until_offline, wait_until_online,
    DeviceEvent, FakeDevice, StreamHandling, TestRelay,
};
use termexo_relay::audit::action;
use termexo_relay_protocol::frames::DeviceKind;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message as WsMessage;

/// The pair every test here starts from: `entry` is the relay a browser opens, `edge` is the one
/// the desktop actually joined.
struct Cascade {
    entry: TestRelay,
    edge: TestRelay,
    entry_console: reqwest::Client,
    edge_console: reqwest::Client,
}

impl Cascade {
    /// Starts both relays and makes `edge` a downstream of `entry`.
    async fn start() -> Self {
        let entry = TestRelay::start().await;
        let edge = TestRelay::start().await;
        let entry_console = login(&entry).await;
        let edge_console = login(&edge).await;

        let code = issue_code(&entry, &entry_console, "relay").await;
        let response = join_upstream(&edge, &edge_console, &entry, &code).await;
        assert_eq!(
            response.status(),
            reqwest::StatusCode::CREATED,
            "建立上游链接应当成功"
        );

        let cascade = Self {
            entry,
            edge,
            entry_console,
            edge_console,
        };
        cascade.wait_until_linked().await;
        cascade
    }

    async fn wait_until_linked(&self) {
        let upstream = wait_for_upstream_state(&self.edge, &self.edge_console, "connected").await;
        assert_eq!(upstream["url"], self.entry.origin());
        assert_eq!(upstream["relayId"], self.entry.state.relay_id.as_str());
        assert_eq!(
            upstream["chain"],
            serde_json::json!([self.entry.state.relay_id]),
            "链应当以上游自己的 id 开头"
        );
        assert_eq!(upstream["error"], serde_json::Value::Null);
    }

    /// Joins a fake desktop to the edge relay and waits until the entry relay can route to it.
    async fn attach_desktop(&self) -> (FakeDevice, String, DeviceEvent) {
        let code = issue_code(&self.edge, &self.edge_console, "desktop").await;
        let (credential, device_id) = enroll(&self.edge, &code, "办公室电脑").await;
        let mut device = FakeDevice::connect(
            &self.edge,
            &credential,
            DeviceKind::Desktop,
            None,
            StreamHandling::Serve(device_router()),
        )
        .await;

        let welcome = device.next_event().await;
        wait_until_online(&self.edge, &device_id).await;
        wait_until_online(&self.entry, &device_id).await;
        (device, device_id, welcome)
    }
}

#[tokio::test]
async fn a_desktop_behind_a_cascaded_relay_answers_at_the_top_of_the_chain() {
    let cascade = Cascade::start().await;
    let (_device, device_id, welcome) = cascade.attach_desktop().await;

    // The desktop is told about both relays, the further one counted as one hop more.
    match &welcome {
        DeviceEvent::Welcome {
            addresses, chain, ..
        } => {
            assert_eq!(
                welcome.urls(),
                [
                    format!("{}/d/{device_id}/", cascade.edge.origin()),
                    format!("{}/d/{device_id}/", cascade.entry.origin()),
                ],
                "welcome 应当同时给出两台中继上的地址"
            );
            assert_eq!(
                addresses
                    .iter()
                    .map(|address| address.hops)
                    .collect::<Vec<_>>(),
                [0, 1]
            );
            assert_eq!(chain, &vec![cascade.entry.state.relay_id.clone()]);
        }
        other => panic!("第一帧应当是 welcome，实际是 {other:?}"),
    }

    // A browser on the entry relay reaches the desktop through the edge relay.
    let response = reqwest::Client::new()
        .get(format!("{}/d/{device_id}/hello", cascade.entry.origin()))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(
        response.text().await.expect("a body"),
        format!("设备已应答 base=/d/{device_id}/"),
        "中间那一跳不应改写请求"
    );

    // And the entry relay's console lists it as reached through the edge relay.
    let devices = admin_devices(&cascade.entry, &cascade.entry_console).await;
    let announced = devices
        .iter()
        .find(|device| device["id"] == device_id.as_str())
        .expect("上游控制台应当列出下游名下的设备");
    assert_eq!(announced["online"], true);
    assert_eq!(
        announced["via"],
        serde_json::json!([cascade.edge.state.relay_id])
    );
    assert_eq!(
        announced["viaNames"][0],
        cascade.edge.state.public_url().host(),
        "跳应当显示下游中继接入时用的名称"
    );
}

#[tokio::test]
async fn a_websocket_survives_both_hops() {
    let cascade = Cascade::start().await;
    let (_device, device_id, _welcome) = cascade.attach_desktop().await;

    let request = format!("{}/d/{device_id}/ws", cascade.entry.websocket_origin())
        .into_client_request()
        .expect("the handshake request should build");
    let (mut socket, response) = tokio_tungstenite::connect_async(request)
        .await
        .expect("the WebSocket should upgrade across the chain");

    assert_eq!(response.status().as_u16(), 101);
    socket
        .send(WsMessage::text("你好"))
        .await
        .expect("the message should be sent");
    let echoed = socket
        .next()
        .await
        .expect("the desktop should answer")
        .expect("the frame should decode");
    assert_eq!(echoed, WsMessage::text("回显：你好"));
}

#[tokio::test]
async fn a_desktop_that_goes_offline_is_withdrawn_all_the_way_up() {
    let cascade = Cascade::start().await;
    let (device, device_id, _welcome) = cascade.attach_desktop().await;

    device.power_off();
    wait_until_offline(&cascade.edge, &device_id).await;
    wait_until_offline(&cascade.entry, &device_id).await;

    let response = reqwest::Client::new()
        .get(format!("{}/d/{device_id}/", cascade.entry.origin()))
        .send()
        .await
        .expect("the request should reach the relay");

    assert_eq!(response.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
    let page = response.text().await.expect("a body");
    assert!(page.contains("设备离线"), "离线页面应当是中文的：{page}");
    assert!(
        page.contains("办公室电脑"),
        "上游应当记得这台设备的名称：{page}"
    );
}

/// Dropping the upstream has to reach the desktop: the address it was given no longer resolves.
#[tokio::test]
async fn leaving_the_upstream_pushes_a_shorter_address_list_to_every_device() {
    let cascade = Cascade::start().await;
    let (mut device, device_id, _welcome) = cascade.attach_desktop().await;

    let response = leave_upstream(&cascade.edge, &cascade.edge_console).await;
    assert_eq!(response.status(), reqwest::StatusCode::NO_CONTENT);

    let pushed = device
        .wait_for(|event| matches!(event, DeviceEvent::Addresses(_)))
        .await;
    assert_eq!(
        pushed.urls(),
        [format!("{}/d/{device_id}/", cascade.edge.origin())],
        "断开上游后只剩下本中继的地址"
    );
    assert_eq!(
        relay_overview(&cascade.edge, &cascade.edge_console).await["upstream"],
        serde_json::Value::Null
    );
    assert!(audited(&cascade.edge, action::UPSTREAM_UNLINKED));
    assert!(audited(&cascade.edge, action::UPSTREAM_CONNECTED));
}

/// Closing the ring is refused at the handshake: the entry relay already appears in the chain the
/// edge relay would hand it back.
#[tokio::test]
async fn a_link_that_would_close_the_ring_is_refused_and_not_retried() {
    let cascade = Cascade::start().await;

    let code = issue_code(&cascade.edge, &cascade.edge_console, "relay").await;
    let response =
        join_upstream(&cascade.entry, &cascade.entry_console, &cascade.edge, &code).await;
    assert_eq!(
        response.status(),
        reqwest::StatusCode::CREATED,
        "凭据交换本身会成功，环路要到握手时才看得出来"
    );

    let upstream = wait_for_upstream_state(&cascade.entry, &cascade.entry_console, "error").await;

    assert!(
        upstream["error"]
            .as_str()
            .is_some_and(|error| error.contains("环路")),
        "失败原因应当说明成环，实际是 {upstream}"
    );
    assert!(audited(&cascade.entry, action::UPSTREAM_LOOP_REFUSED));
    // A refused loop must not be dialled again: the state is still the refusal a moment later.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert_eq!(
        relay_overview(&cascade.entry, &cascade.entry_console).await["upstream"]["state"],
        "error"
    );
}
