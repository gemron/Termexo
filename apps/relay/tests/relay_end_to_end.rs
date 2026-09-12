//! End-to-end tests: a relay, a real tunnel and a fake device, all inside one process.

mod support;

use futures_util::{SinkExt, StreamExt};
use support::{
    device_router, enroll, issue_code, login, wait_until_online, DeviceEvent, FakeDevice,
    StreamHandling, TestRelay,
};
use termexo_relay::audit::action;
use termexo_relay::db::AuditQuery;
use termexo_relay_protocol::frames::{AnnouncedDevice, ControlFrame, DeviceKind};
use termexo_relay_protocol::tunnel::CLOSE_REVOKED;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::{Error as WsError, Message as WsMessage};

/// The relay never answers a redeemed code twice, so each test issues its own.
async fn connected_device(relay: &TestRelay) -> (FakeDevice, String) {
    let console = login(relay).await;
    let code = issue_code(relay, &console, "desktop").await;
    let (credential, device_id) = enroll(relay, &code, "书房台式机").await;
    let mut device = FakeDevice::connect(
        relay,
        &credential,
        DeviceKind::Desktop,
        None,
        StreamHandling::Serve(device_router()),
    )
    .await;

    let welcome = device.next_event().await;
    match &welcome {
        DeviceEvent::Welcome {
            device_id: welcomed,
            chain,
            ..
        } => {
            assert_eq!(welcomed, &device_id);
            assert_eq!(
                welcome.urls(),
                [format!("{}/d/{device_id}/", relay.origin())],
                "welcome 应当带上这台设备的公开地址"
            );
            assert!(chain.is_empty(), "没有上游的中继是链的顶端");
        }
        other => panic!("第一帧应当是 welcome，实际是 {other:?}"),
    }
    wait_until_online(relay, &device_id).await;
    (device, device_id)
}

#[tokio::test]
async fn a_browser_reaches_its_device_through_the_relay() {
    let relay = TestRelay::start().await;
    let (_device, device_id) = connected_device(&relay).await;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("the client should build");

    let response = client
        .get(format!("{}/d/{device_id}/hello", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay");

    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(
        response.text().await.expect("a body"),
        format!("设备已应答 base=/d/{device_id}/"),
        "设备应当收到中继设置的 base 头"
    );

    // The address without its trailing slash has to redirect, or relative assets resolve one level
    // too high in the browser.
    let redirect = client
        .get(format!("{}/d/{device_id}", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(redirect.status(), reqwest::StatusCode::FOUND);
    assert_eq!(
        redirect
            .headers()
            .get("location")
            .and_then(|value| value.to_str().ok()),
        Some(format!("/d/{device_id}/").as_str())
    );
}

#[tokio::test]
async fn a_websocket_is_echoed_back_through_the_relay() {
    let relay = TestRelay::start().await;
    let (_device, device_id) = connected_device(&relay).await;

    let request = format!("{}/d/{device_id}/ws", relay.websocket_origin())
        .into_client_request()
        .expect("the handshake request should build");
    let (mut socket, response) = tokio_tungstenite::connect_async(request)
        .await
        .expect("the WebSocket should upgrade through the relay");

    assert_eq!(response.status().as_u16(), 101);
    socket
        .send(WsMessage::text("你好"))
        .await
        .expect("the message should be sent");
    let echoed = socket
        .next()
        .await
        .expect("the device should answer")
        .expect("the frame should decode");
    assert_eq!(echoed, WsMessage::text("回显：你好"));
}

#[tokio::test]
async fn revoking_a_device_closes_the_tunnel_and_takes_the_address_offline() {
    let relay = TestRelay::start().await;
    let (mut device, device_id) = connected_device(&relay).await;
    let console = login(&relay).await;

    let revoked = console
        .post(format!(
            "{}/api/admin/devices/{device_id}/revoke",
            relay.origin()
        ))
        .header("x-requested-with", "termexo-console")
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(revoked.status(), reqwest::StatusCode::OK);

    let reason = device
        .wait_for(|event| matches!(event, DeviceEvent::Revoked(_)))
        .await;
    assert!(
        matches!(&reason, DeviceEvent::Revoked(text) if text.contains("撤销")),
        "设备应当收到中文的撤销原因，实际是 {reason:?}"
    );
    let closed = device
        .wait_for(|event| matches!(event, DeviceEvent::Closed(_)))
        .await;
    assert_eq!(
        closed,
        DeviceEvent::Closed(Some(CLOSE_REVOKED)),
        "隧道应当以 4403 关闭"
    );

    let offline = reqwest::Client::new()
        .get(format!("{}/d/{device_id}/", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(offline.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
    assert!(
        offline.text().await.expect("a body").contains("设备离线"),
        "离线页面应当是中文的"
    );
}

#[tokio::test]
async fn repeated_bad_credentials_lock_the_source_out() {
    let relay = TestRelay::start().await;
    let bogus = termexo_relay_protocol::credential::DeviceCredential::generate()
        .expect("a credential")
        .to_string();

    // Five refusals fill the window; the sixth is turned away before the credential is even read.
    for _ in 0..5 {
        assert_eq!(attempt_tunnel(&relay, &bogus).await, 401);
    }
    assert_eq!(attempt_tunnel(&relay, &bogus).await, 401);

    let rejected = relay
        .state
        .database
        .list_audit(&AuditQuery {
            limit: 100,
            ..AuditQuery::default()
        })
        .expect("the audit list should work")
        .into_iter()
        .filter(|event| event.action == action::TUNNEL_REJECTED)
        .count();
    assert_eq!(
        rejected, 5,
        "锁定之后的尝试不应再产生凭据校验，因此不再记审计"
    );
}

#[tokio::test]
async fn a_device_behind_a_downstream_relay_is_reachable() {
    let relay = TestRelay::start().await;
    let console = login(&relay).await;
    let code = issue_code(&relay, &console, "relay").await;
    let (credential, link_device_id) = enroll(&relay, &code, "办公室中继").await;

    const DOWNSTREAM_RELAY_ID: &str = "relay-b";
    const ANNOUNCED_DEVICE_ID: &str = "announced-office-desktop";

    let mut link = FakeDevice::connect(
        &relay,
        &credential,
        DeviceKind::Relay,
        Some(DOWNSTREAM_RELAY_ID),
        StreamHandling::Forward {
            device: device_router(),
            expected_target: ANNOUNCED_DEVICE_ID.to_string(),
            expected_hops: vec![relay.state.relay_id.clone()],
        },
    )
    .await;
    assert!(matches!(
        link.next_event().await,
        DeviceEvent::Welcome { .. }
    ));
    wait_until_online(&relay, &link_device_id).await;

    link.send(ControlFrame::Announce {
        devices: vec![AnnouncedDevice {
            id: ANNOUNCED_DEVICE_ID.into(),
            name: "办公室电脑".into(),
            online: true,
            via: vec![DOWNSTREAM_RELAY_ID.into()],
        }],
    });
    wait_until_online(&relay, ANNOUNCED_DEVICE_ID).await;

    let response = reqwest::Client::new()
        .get(format!("{}/d/{ANNOUNCED_DEVICE_ID}/hello", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay");

    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(
        response.text().await.expect("a body"),
        format!("设备已应答 base=/d/{ANNOUNCED_DEVICE_ID}/")
    );

    // The console lists the announced device with the hop it travelled over.
    let devices: serde_json::Value = console
        .get(format!("{}/api/admin/devices", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay")
        .json()
        .await
        .expect("a JSON body");
    let announced = devices["devices"]
        .as_array()
        .expect("an array")
        .iter()
        .find(|device| device["id"] == ANNOUNCED_DEVICE_ID)
        .expect("控制台应当列出经下游中继通告的设备");
    assert_eq!(announced["via"][0], DOWNSTREAM_RELAY_ID);
    assert_eq!(announced["viaNames"][0], "办公室中继");
    assert_eq!(announced["online"], true);
}

/// Attempts a tunnel handshake that is expected to be refused, and reports the status.
async fn attempt_tunnel(relay: &TestRelay, credential: &str) -> u16 {
    let mut request = format!("{}/tunnel", relay.websocket_origin())
        .into_client_request()
        .expect("the handshake request should build");
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {credential}")
            .parse()
            .expect("a header value"),
    );
    match tokio_tungstenite::connect_async(request).await {
        Ok(_) => panic!("无效凭据不应当建立隧道"),
        Err(WsError::Http(response)) => response.status().as_u16(),
        Err(other) => panic!("意外的握手错误：{other}"),
    }
}
