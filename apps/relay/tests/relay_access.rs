//! The two ways a device address is reached and gated: `access = relay-login`, and the subdomain
//! entry a relay offers once it has a wildcard domain.

mod support;

use futures_util::{SinkExt, StreamExt};
use support::{
    connect_desktop, create_user, login, redirect_location, set_device_access, sign_in, TestRelay,
};
use termexo_relay::audit::action;
use termexo_relay::db::UserRole;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Error as WsError;

/// The wildcard domain the subdomain tests pretend the relay owns.
const SUBDOMAIN_BASE: &str = "relay.test";

const OWNER_USERNAME: &str = "ada";
const STRANGER_USERNAME: &str = "mallory";
const ACCOUNT_PASSWORD: &str = "relay-test-password";

#[tokio::test]
async fn a_restricted_device_turns_a_stranger_away_and_lets_its_owner_through() {
    let relay = TestRelay::start().await;
    let console = login(&relay).await;
    let owner = create_user(&relay, OWNER_USERNAME, ACCOUNT_PASSWORD, UserRole::User);
    let stranger = create_user(&relay, STRANGER_USERNAME, ACCOUNT_PASSWORD, UserRole::User);
    let connected = connect_desktop(&relay, &console, "书房台式机", Some(&owner)).await;
    let device_id = connected.device_id.clone();
    set_device_access(&relay, &console, &device_id, "relay-login").await;

    // Nobody signed in: the browser is sent to the console's login page with a way back.
    let anonymous = relay
        .anonymous_client()
        .get(format!("{}/d/{device_id}/hello", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(anonymous.status(), reqwest::StatusCode::FOUND);
    assert_eq!(
        redirect_location(&anonymous),
        format!("/console/login?next=%2Fd%2F{device_id}%2Fhello")
    );

    // Signed in, but the device is somebody else's.
    assert_ne!(stranger, owner, "两个账号应当是不同的人");
    let refused = sign_in(&relay, STRANGER_USERNAME, ACCOUNT_PASSWORD)
        .await
        .get(format!("{}/d/{device_id}/hello", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(refused.status(), reqwest::StatusCode::FORBIDDEN);
    assert!(
        refused.text().await.expect("a body").contains("所有者"),
        "403 页面应当用中文说明为什么被拒绝"
    );

    // The owner, and the administrator who runs the relay, both reach the workbench.
    for client in [
        sign_in(&relay, OWNER_USERNAME, ACCOUNT_PASSWORD).await,
        login(&relay).await,
    ] {
        let allowed = client
            .get(format!("{}/d/{device_id}/hello", relay.origin()))
            .send()
            .await
            .expect("the request should reach the relay");
        assert_eq!(allowed.status(), reqwest::StatusCode::OK);
        assert_eq!(
            allowed.text().await.expect("a body"),
            format!("设备已应答 base=/d/{device_id}/")
        );
    }

    assert!(
        support::audited(&relay, action::DEVICE_ACCESS_CHANGED),
        "改变访问策略应当留下审计记录"
    );
}

/// The document is not the gate worth guarding — `/ws` is what carries the terminal.
#[tokio::test]
async fn a_restricted_device_refuses_a_websocket_upgrade_from_a_stranger() {
    let relay = TestRelay::start().await;
    let console = login(&relay).await;
    let owner = create_user(&relay, OWNER_USERNAME, ACCOUNT_PASSWORD, UserRole::User);
    let connected = connect_desktop(&relay, &console, "书房台式机", Some(&owner)).await;
    let device_id = connected.device_id.clone();

    // While it is public the upgrade succeeds, so the refusal below is the policy talking.
    let request = format!("{}/d/{device_id}/ws", relay.websocket_origin())
        .into_client_request()
        .expect("the handshake request should build");
    assert!(tokio_tungstenite::connect_async(request).await.is_ok());

    set_device_access(&relay, &console, &device_id, "relay-login").await;

    let request = format!("{}/d/{device_id}/ws", relay.websocket_origin())
        .into_client_request()
        .expect("the handshake request should build");
    match tokio_tungstenite::connect_async(request).await {
        Ok(_) => panic!("未登录的浏览器不应当升级受限设备的 WebSocket"),
        Err(WsError::Http(response)) => {
            assert_eq!(response.status(), reqwest::StatusCode::FOUND);
        }
        Err(other) => panic!("意外的握手错误：{other}"),
    }
}

/// A device a downstream relay announced has no row here, so this relay has no policy to apply to
/// it; the relay it enrolled with is the one that does.
#[tokio::test]
async fn a_devices_policy_cannot_be_set_through_a_relay_that_only_routes_to_it() {
    let relay = TestRelay::start().await;
    let console = login(&relay).await;

    let response = console
        .patch(format!(
            "{}/api/admin/devices/announced-device",
            relay.origin()
        ))
        .header("x-requested-with", "termexo-console")
        .json(&serde_json::json!({ "access": "relay-login" }))
        .send()
        .await
        .expect("the request should reach the relay");

    assert_eq!(response.status(), reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_unknown_access_policy_is_refused_by_name() {
    let relay = TestRelay::start().await;
    let console = login(&relay).await;
    let connected = connect_desktop(&relay, &console, "书房台式机", None).await;

    let response = console
        .patch(format!(
            "{}/api/admin/devices/{}",
            relay.origin(),
            connected.device_id
        ))
        .header("x-requested-with", "termexo-console")
        .json(&serde_json::json!({ "access": "everyone" }))
        .send()
        .await
        .expect("the request should reach the relay");

    assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
    let body: serde_json::Value = response.json().await.expect("a JSON body");
    assert!(
        body["error"]
            .as_str()
            .expect("an error sentence")
            .contains("relay-login"),
        "错误信息应当说明可用取值，实际是 {body}"
    );
}

#[tokio::test]
async fn a_device_subdomain_reaches_the_device_while_the_path_form_keeps_working() {
    let relay = TestRelay::start_with_subdomain_base(SUBDOMAIN_BASE).await;
    let console = login(&relay).await;
    let connected = connect_desktop(&relay, &console, "书房台式机", None).await;
    let device_id = connected.device_id.clone();
    let device_host = format!("{device_id}.{SUBDOMAIN_BASE}");

    // On the device's own host the whole path belongs to the device, so its base is the root.
    let response = relay
        .client_for_host(&device_host)
        .get(format!("{}/hello", relay.origin_for_host(&device_host)))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(
        response.text().await.expect("a body"),
        "设备已应答 base=/",
        "子域名入口的 base 应当是根"
    );

    // Links handed out before the wildcard domain existed still have to work.
    let by_path = relay
        .anonymous_client()
        .get(format!("{}/d/{device_id}/hello", relay.origin()))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(by_path.status(), reqwest::StatusCode::OK);
    assert_eq!(
        by_path.text().await.expect("a body"),
        format!("设备已应答 base=/d/{device_id}/")
    );
}

/// The console and `/api/*` stay on the base host; only a well-formed device label is a device.
#[tokio::test]
async fn the_base_host_still_serves_the_relay_itself() {
    let relay = TestRelay::start_with_subdomain_base(SUBDOMAIN_BASE).await;
    let client = relay.client_for_host(SUBDOMAIN_BASE);
    let origin = relay.origin_for_host(SUBDOMAIN_BASE);

    let health = client
        .get(format!("{origin}/api/health"))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(health.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = health.json().await.expect("a JSON body");
    assert_eq!(body["relayId"], relay.state.relay_id.as_str());

    // The root of the base host is the console, not a device.
    let root = client
        .get(format!("{origin}/"))
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(root.status(), reqwest::StatusCode::FOUND);
    assert_eq!(redirect_location(&root), "/console/");
}

#[tokio::test]
async fn every_address_the_relay_hands_out_uses_the_subdomain_form() {
    let relay = TestRelay::start_with_subdomain_base(SUBDOMAIN_BASE).await;
    let console = login(&relay).await;
    let connected = connect_desktop(&relay, &console, "书房台式机", None).await;
    let expected = format!(
        "http://{}.{SUBDOMAIN_BASE}:{}/",
        connected.device_id,
        relay.address.port()
    );

    assert_eq!(
        connected.welcome.urls(),
        vec![expected.clone()],
        "welcome 的地址应当是子域名形式"
    );

    let devices = support::admin_devices(&relay, &console).await;
    let listed = devices
        .iter()
        .find(|device| device["id"] == connected.device_id.as_str())
        .expect("控制台应当列出这台设备");
    assert_eq!(listed["accessUrl"], expected);
    assert_eq!(listed["access"], "public");
}

/// `--tls off --trusted-proxy <CIDR>` is the deployment the design recommends for the public
/// internet: Caddy terminates TLS and the relay believes only its forwarding headers.
#[tokio::test]
async fn a_relay_behind_a_reverse_proxy_serves_the_proxys_origin() {
    const PUBLIC_ORIGIN: &str = "https://relay.example.com";
    let relay = TestRelay::start_behind_proxy(PUBLIC_ORIGIN).await;
    let console = login(&relay).await;
    let connected = connect_desktop(&relay, &console, "书房台式机", None).await;
    let device_id = connected.device_id.clone();

    // The address handed to the device and to the console is the proxy's, not the listener's.
    assert_eq!(
        connected.welcome.urls(),
        vec![format!("{PUBLIC_ORIGIN}/d/{device_id}/")],
        "地址应当用 --public-url 而不是监听地址"
    );

    // What the proxy says about the browser is what the device is told.
    let response = relay
        .anonymous_client()
        .get(format!("{}/d/{device_id}/hello", relay.origin()))
        .header("x-forwarded-for", "203.0.113.5, 127.0.0.1")
        .header("x-forwarded-proto", "https")
        .header("x-forwarded-host", "relay.example.com")
        .send()
        .await
        .expect("the request should reach the relay");
    assert_eq!(response.status(), reqwest::StatusCode::OK);

    let devices = support::admin_devices(&relay, &console).await;
    let listed = devices
        .iter()
        .find(|device| device["id"] == device_id.as_str())
        .expect("控制台应当列出这台设备");
    assert_eq!(
        listed["accessUrl"],
        format!("{PUBLIC_ORIGIN}/d/{device_id}/")
    );

    // Caddy forwards an upgrade untouched, so the WebSocket has to survive the extra hop.
    let request = format!("{}/d/{device_id}/ws", relay.websocket_origin())
        .into_client_request()
        .expect("the handshake request should build");
    let (mut socket, upgraded) = tokio_tungstenite::connect_async(request)
        .await
        .expect("the WebSocket should upgrade through the relay");
    assert_eq!(upgraded.status().as_u16(), 101);
    socket
        .send(tokio_tungstenite::tungstenite::Message::text("你好"))
        .await
        .expect("the message should be sent");
    let echoed = socket
        .next()
        .await
        .expect("the device should answer")
        .expect("the frame should decode");
    assert_eq!(
        echoed,
        tokio_tungstenite::tungstenite::Message::text("回显：你好")
    );
}

/// A console session cookie is host-only, so it never reaches a device subdomain; the path form on
/// the relay's own host is the entry that can be authenticated.
#[tokio::test]
async fn a_restricted_device_on_its_subdomain_is_sent_to_the_path_form() {
    let relay = TestRelay::start_with_subdomain_base(SUBDOMAIN_BASE).await;
    let console = login(&relay).await;
    let connected = connect_desktop(&relay, &console, "书房台式机", None).await;
    let device_id = connected.device_id.clone();
    set_device_access(&relay, &console, &device_id, "relay-login").await;
    let device_host = format!("{device_id}.{SUBDOMAIN_BASE}");

    let response = relay
        .client_for_host(&device_host)
        .get(format!("{}/hello", relay.origin_for_host(&device_host)))
        .send()
        .await
        .expect("the request should reach the relay");

    assert_eq!(response.status(), reqwest::StatusCode::FOUND);
    assert_eq!(
        redirect_location(&response),
        format!("{}/d/{device_id}/hello", relay.origin())
    );
}
