use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Serialize;
use url::Url;

use crate::config::NetworkProfile;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// Budget for the proxy to answer a CONNECT request once the socket is open.
const TUNNEL_TIMEOUT: Duration = Duration::from_secs(5);
/// Endpoint the tunnel probe asks for. Reaching the proxy is not the same as the proxy being
/// able to reach the model API, and it is the second one that decides whether an agent works.
const PROBE_HOST: &str = "api.anthropic.com";
const PROBE_PORT: u16 = 443;
const PROXY_SCHEMES: &[&str] = &["http", "https", "socks4", "socks5", "socks5h"];
const HTTP_SCHEMES: &[&str] = &["http", "https"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkTestResult {
    pub profile_id: String,
    pub healthy: bool,
    pub target: String,
    pub message: String,
    pub latency_ms: u128,
}

pub fn validate_profile(profile: &NetworkProfile) -> Result<(), String> {
    if profile.name.trim().is_empty() {
        return Err("代理 Profile 名称不能为空".into());
    }
    match profile.scope.as_str() {
        "global" if profile.workspace_id.is_some() => {
            return Err("全局代理不能绑定 Workspace".into());
        }
        "workspace"
            if profile
                .workspace_id
                .as_deref()
                .map(str::trim)
                .map_or(true, str::is_empty) =>
        {
            return Err("Workspace 代理必须绑定工作区".into());
        }
        "global" | "workspace" => {}
        _ => return Err("代理作用域必须是 global 或 workspace".into()),
    }

    for (label, value) in [
        ("HTTP 代理", profile.http_proxy.as_deref()),
        ("HTTPS 代理", profile.https_proxy.as_deref()),
        ("ALL_PROXY", profile.all_proxy.as_deref()),
    ] {
        if let Some(value) = trimmed(value) {
            reject_tls_proxy_scheme(label, value)?;
        }
    }

    for (label, value, schemes) in [
        ("HTTP 代理", profile.http_proxy.as_deref(), PROXY_SCHEMES),
        ("HTTPS 代理", profile.https_proxy.as_deref(), PROXY_SCHEMES),
        ("ALL_PROXY", profile.all_proxy.as_deref(), PROXY_SCHEMES),
        (
            "npm registry",
            profile.npm_registry.as_deref(),
            HTTP_SCHEMES,
        ),
        ("npm proxy", profile.npm_proxy.as_deref(), HTTP_SCHEMES),
        (
            "npm https-proxy",
            profile.npm_https_proxy.as_deref(),
            HTTP_SCHEMES,
        ),
    ] {
        if let Some(value) = trimmed(value) {
            validate_url(label, value, schemes)?;
        }
    }
    Ok(())
}

pub fn profile_environment(
    profile: &NetworkProfile,
    proxy_password: Option<&str>,
) -> Result<HashMap<String, String>, String> {
    validate_profile(profile)?;
    if !profile.enabled {
        return Ok(HashMap::new());
    }
    if proxy_password.is_some()
        && profile
            .proxy_username
            .as_deref()
            .map_or(true, str::is_empty)
    {
        return Err("代理密码存在时必须填写用户名".into());
    }

    let mut environment = HashMap::new();
    insert_proxy_pair(
        &mut environment,
        "HTTP_PROXY",
        "http_proxy",
        profile.http_proxy.as_deref(),
        profile.proxy_username.as_deref(),
        proxy_password,
    )?;
    insert_proxy_pair(
        &mut environment,
        "HTTPS_PROXY",
        "https_proxy",
        profile.https_proxy.as_deref(),
        profile.proxy_username.as_deref(),
        proxy_password,
    )?;
    insert_proxy_pair(
        &mut environment,
        "ALL_PROXY",
        "all_proxy",
        profile.all_proxy.as_deref(),
        profile.proxy_username.as_deref(),
        proxy_password,
    )?;
    if let Some(value) = trimmed(profile.no_proxy.as_deref()) {
        environment.insert("NO_PROXY".into(), value.into());
        environment.insert("no_proxy".into(), value.into());
        // npm reads NO_PROXY too, but its own `noproxy` config wins when both are present —
        // leaving it unset would let an explicit NPM_CONFIG_PROXY capture excluded hosts. npm's
        // format is narrower than Windows/system bypass lists, so translate it independently.
        if let Some(value) = npm_no_proxy(value) {
            environment.insert("NPM_CONFIG_NOPROXY".into(), value);
        }
    }

    if let Some(value) = trimmed(profile.npm_registry.as_deref()) {
        environment.insert("NPM_CONFIG_REGISTRY".into(), value.into());
    }
    insert_npm_proxy(
        &mut environment,
        "NPM_CONFIG_PROXY",
        profile.npm_proxy.as_deref(),
        profile.proxy_username.as_deref(),
        proxy_password,
    )?;
    insert_npm_proxy(
        &mut environment,
        "NPM_CONFIG_HTTPS_PROXY",
        profile.npm_https_proxy.as_deref(),
        profile.proxy_username.as_deref(),
        proxy_password,
    )?;
    environment.insert(
        "NPM_CONFIG_STRICT_SSL".into(),
        profile.npm_strict_ssl.to_string(),
    );
    if let Some(value) = trimmed(profile.npm_ca_path.as_deref()) {
        environment.insert("NPM_CONFIG_CAFILE".into(), value.into());
    }
    Ok(environment)
}

/// Converts common system/Windows bypass-list forms to npm's comma-delimited domain extensions.
///
/// npm's current proxy matcher compares hostname segments. It therefore cannot match Windows'
/// `*.example.com` spelling or entries carrying a port, and it sees a bare IPv6 address differently
/// from URL.hostname. The system variables keep the user's original value; only npm receives this
/// compatibility form.
fn npm_no_proxy(value: &str) -> Option<String> {
    let mut entries = Vec::<String>::new();
    let mut push = |entry: &str| {
        let Some(entry) = npm_no_proxy_entry(entry) else {
            return;
        };
        if !entries
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&entry))
        {
            entries.push(entry);
        }
    };

    for entry in value
        .split([',', ';', '\n', '\r'])
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        if entry.eq_ignore_ascii_case("<local>") {
            for local in ["localhost", "127.0.0.1", "::1"] {
                push(local);
            }
        } else {
            push(entry);
        }
    }

    (!entries.is_empty()).then(|| entries.join(","))
}

fn npm_no_proxy_entry(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }

    if value.contains("://") {
        if let Ok(url) = Url::parse(value) {
            return url.host().map(|host| match host {
                url::Host::Ipv6(address) => format!("[{address}]"),
                _ => host.to_string(),
            });
        }
    }

    // Windows uses `*.domain`; npm expects a domain extension and already includes subdomains.
    let value = value
        .strip_prefix("*.")
        .map(|domain| format!(".{domain}"))
        .unwrap_or_else(|| value.trim_start_matches('*').to_owned());
    if value.is_empty() {
        // Preserve the global wildcard. Some npm versions/libraries support it even though the
        // current @npmcli/agent matcher only documents domain extensions.
        return Some("*".into());
    }

    if value.starts_with('[') {
        // A bracketed IPv6 address may carry a port; npm compares URL.hostname including brackets.
        return value
            .find(']')
            .map(|end| value[..=end].to_owned())
            .or(Some(value));
    }
    if value.matches(':').count() > 1 && !value.contains('/') {
        return Some(format!("[{value}]"));
    }
    if let Some((host, port)) = value.rsplit_once(':') {
        if !host.is_empty() && port.chars().all(|character| character.is_ascii_digit()) {
            return Some(host.to_owned());
        }
    }
    Some(value)
}

pub fn test_profile(
    profile: &NetworkProfile,
    proxy_password: Option<&str>,
) -> Result<NetworkTestResult, String> {
    let environment = profile_environment(profile, proxy_password)?;
    if environment.is_empty() {
        return Ok(NetworkTestResult {
            profile_id: profile.id.clone(),
            healthy: true,
            target: "disabled".into(),
            message: "Profile 已禁用，配置格式有效".into(),
            latency_ms: 0,
        });
    }

    let target = [
        profile.all_proxy.as_deref(),
        profile.https_proxy.as_deref(),
        profile.http_proxy.as_deref(),
        profile.npm_https_proxy.as_deref(),
        profile.npm_proxy.as_deref(),
        profile.npm_registry.as_deref(),
    ]
    .into_iter()
    .flatten()
    .find_map(|value| trimmed(Some(value)));

    let Some(target) = target else {
        return Ok(NetworkTestResult {
            profile_id: profile.id.clone(),
            healthy: true,
            target: "environment-only".into(),
            message: "环境变量配置有效，没有需要连接测试的代理或 registry".into(),
            latency_ms: 0,
        });
    };
    let parsed = Url::parse(target).map_err(|error| format!("测试地址无效：{error}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "测试地址缺少主机名".to_owned())?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "测试地址缺少端口".to_owned())?;
    let display_target = format!("{}://{}:{}", parsed.scheme(), host, port);
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("DNS 解析失败：{error}"))?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err("DNS 解析没有返回可连接地址".into());
    }

    let started = Instant::now();
    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
            Ok(stream) => {
                // An HTTP proxy that accepts the socket may still refuse to tunnel — it can
                // demand credentials or block the destination. Agents would then hang until
                // their request timeout, so the probe has to go one step further.
                let (healthy, message) = match probe_http_tunnel(stream, &parsed) {
                    Some(result) => result,
                    None => (true, "TCP 连通性测试通过".to_owned()),
                };
                return Ok(NetworkTestResult {
                    profile_id: profile.id.clone(),
                    healthy,
                    target: display_target,
                    message,
                    latency_ms: started.elapsed().as_millis(),
                });
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(format!(
        "{} 连接失败：{}",
        display_target,
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "未知错误".into())
    ))
}

/// Asks an HTTP proxy to open a tunnel to the model API and reports what it answered.
///
/// Returns `None` when the target is not an HTTP proxy (SOCKS, or a plain registry URL), where
/// a successful socket is all this probe can establish.
fn probe_http_tunnel(mut stream: TcpStream, proxy: &Url) -> Option<(bool, String)> {
    if !HTTP_SCHEMES.contains(&proxy.scheme()) {
        return None;
    }
    stream.set_read_timeout(Some(TUNNEL_TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(TUNNEL_TIMEOUT)).ok()?;

    let request = format!(
        "CONNECT {PROBE_HOST}:{PROBE_PORT} HTTP/1.1\r\nHost: {PROBE_HOST}:{PROBE_PORT}\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return Some((false, format!("代理未响应 CONNECT {PROBE_HOST} 请求")));
    }

    let mut buffer = [0u8; 256];
    let read = match stream.read(&mut buffer) {
        Ok(0) => return Some((false, "代理在收到 CONNECT 请求后立即关闭了连接".into())),
        Ok(read) => read,
        Err(_) => {
            return Some((
                false,
                format!(
                    "代理在 {} 秒内没有回应 CONNECT 请求",
                    TUNNEL_TIMEOUT.as_secs()
                ),
            ))
        }
    };
    let status_line = String::from_utf8_lossy(&buffer[..read])
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_owned();

    // "200" anywhere in the status line means the tunnel is open; proxies word it differently
    // ("200 Connection established", "200 OK").
    if status_line.contains(" 200") {
        return Some(match probe_tunnel_reaches_destination(&mut stream) {
            Ok(()) => (
                true,
                format!("代理可访问 {PROBE_HOST}，Agent 请求可以正常发出"),
            ),
            Err(reason) => (
                false,
                format!(
                    "代理已建立隧道但无法到达 {PROBE_HOST}：{reason}。\
                     Agent 发送消息时会一直等待直到超时"
                ),
            ),
        });
    }
    if status_line.contains(" 407") {
        return Some((
            false,
            "代理要求身份验证（407），请在 Profile 中填写代理用户名与密码".into(),
        ));
    }
    Some((
        false,
        format!("代理拒绝连接 {PROBE_HOST}：{status_line}。Agent 发送消息时会一直等待直到超时"),
    ))
}

/// Confirms the opened tunnel actually carries traffic to the destination.
///
/// Proxies that route by rule (Clash and friends) answer `200` before they resolve the target,
/// so the status line alone cannot distinguish a working route from a dead one. Sending a real
/// TLS ClientHello and waiting for the server's response is what settles it.
fn probe_tunnel_reaches_destination(stream: &mut TcpStream) -> Result<(), String> {
    stream
        .write_all(&tls_client_hello(PROBE_HOST))
        .map_err(|error| format!("无法通过隧道发送数据（{error}）"))?;

    let mut buffer = [0u8; 8];
    match stream.read(&mut buffer) {
        // 0x16 is a handshake record and 0x15 an alert. Either one is a TLS server answering,
        // which is all this probe needs: the deliberately minimal ClientHello offers one legacy
        // cipher suite, so a strict endpoint replying "handshake_failure" still proves the
        // tunnel carries traffic end to end.
        Ok(read) if read > 0 && matches!(buffer[0], 0x16 | 0x15) => Ok(()),
        Ok(0) => Err("隧道被立即关闭，目标不可达".into()),
        Ok(_) => Err("目标返回了非 TLS 响应".into()),
        Err(_) => Err(format!("{} 秒内没有收到目标响应", TUNNEL_TIMEOUT.as_secs())),
    }
}

/// Builds a minimal TLS 1.2 ClientHello carrying `host` as SNI.
///
/// Hand-rolled rather than pulled from a TLS crate because the probe only needs the server to
/// say something back — no certificate validation, no session, no handshake completion.
fn tls_client_hello(host: &str) -> Vec<u8> {
    let host = host.as_bytes();
    let mut extensions = Vec::new();
    // server_name extension (RFC 6066)
    extensions.extend_from_slice(&[0x00, 0x00]);
    extensions.extend_from_slice(&((host.len() + 5) as u16).to_be_bytes());
    extensions.extend_from_slice(&((host.len() + 3) as u16).to_be_bytes());
    extensions.push(0x00);
    extensions.extend_from_slice(&(host.len() as u16).to_be_bytes());
    extensions.extend_from_slice(host);

    let mut body = Vec::new();
    body.extend_from_slice(&[0x03, 0x03]); // client_version TLS 1.2
    body.extend_from_slice(&[0x00; 32]); // random
    body.push(0x00); // session_id
    body.extend_from_slice(&[0x00, 0x02, 0x00, 0x2f]); // one cipher suite
    body.extend_from_slice(&[0x01, 0x00]); // null compression
    body.extend_from_slice(&(extensions.len() as u16).to_be_bytes());
    body.extend_from_slice(&extensions);

    let mut handshake = vec![0x01]; // ClientHello
    let length = body.len();
    handshake.extend_from_slice(&[(length >> 16) as u8, (length >> 8) as u8, length as u8]);
    handshake.extend_from_slice(&body);

    let mut record = vec![0x16, 0x03, 0x01]; // handshake record, TLS 1.0 framing
    record.extend_from_slice(&(handshake.len() as u16).to_be_bytes());
    record.extend_from_slice(&handshake);
    record
}

/// Rejects `https://` proxy addresses, which almost never mean what the user intended.
///
/// The scheme of a proxy URL says how to *reach the proxy*, not what it forwards: `https://`
/// asks the client to complete a TLS handshake with the proxy port itself. Ordinary proxies
/// speak plain HTTP there, so the handshake hangs and the agent looks frozen — HTTPS traffic
/// already tunnels correctly through an `http://` proxy via CONNECT.
fn reject_tls_proxy_scheme(label: &str, value: &str) -> Result<(), String> {
    let Ok(parsed) = Url::parse(value) else {
        // A malformed URL is reported by validate_url with a better message.
        return Ok(());
    };
    if parsed.scheme() != "https" {
        return Ok(());
    }
    let corrected = format!("http://{}", value.trim_start_matches("https://"));
    Err(format!(
        "{label}不能使用 https:// 开头。代理地址的协议表示「如何连接代理」而不是「代理转发什么流量」，\
         https:// 会要求先与代理端口完成 TLS 握手，普通代理不支持，Agent 会一直等待直到超时。\
         请改为 {corrected}——HTTPS 请求仍会通过 CONNECT 正常走该代理。"
    ))
}

fn validate_url(label: &str, value: &str, allowed_schemes: &[&str]) -> Result<(), String> {
    let parsed = Url::parse(value).map_err(|error| format!("{label}地址无效：{error}"))?;
    if !allowed_schemes.contains(&parsed.scheme()) {
        return Err(format!(
            "{label}不支持 {} 协议，可用协议：{}",
            parsed.scheme(),
            allowed_schemes.join("、")
        ));
    }
    if parsed.host_str().is_none() {
        return Err(format!("{label}缺少主机名"));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(format!(
            "{label}不能在 URL 中保存账号密码，请使用安全凭据字段"
        ));
    }
    Ok(())
}

fn insert_proxy_pair(
    environment: &mut HashMap<String, String>,
    uppercase_key: &str,
    lowercase_key: &str,
    value: Option<&str>,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<(), String> {
    if let Some(value) = trimmed(value) {
        let resolved = proxy_url_with_credentials(value, username, password)?;
        environment.insert(uppercase_key.into(), resolved.clone());
        environment.insert(lowercase_key.into(), resolved);
    }
    Ok(())
}

fn insert_npm_proxy(
    environment: &mut HashMap<String, String>,
    key: &str,
    value: Option<&str>,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<(), String> {
    if let Some(value) = trimmed(value) {
        environment.insert(
            key.into(),
            proxy_url_with_credentials(value, username, password)?,
        );
    }
    Ok(())
}

fn proxy_url_with_credentials(
    value: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<String, String> {
    let mut parsed = Url::parse(value).map_err(|error| format!("代理地址无效：{error}"))?;
    let Some(username) = username.map(str::trim).filter(|value| !value.is_empty()) else {
        // No credentials to add, so the address is passed through exactly as entered.
        // `Url::to_string` normalises `http://host:8080` into `http://host:8080/`, and that
        // trailing slash makes some HTTP clients treat the proxy as having a path — requests
        // then stall instead of failing fast. Only rewrite when there is something to write.
        return Ok(value.trim().to_owned());
    };
    parsed
        .set_username(username)
        .map_err(|_| "代理用户名无法写入 URL".to_owned())?;
    parsed
        .set_password(password.filter(|value| !value.is_empty()))
        .map_err(|_| "代理密码无法写入 URL".to_owned())?;
    Ok(parsed.to_string())
}

fn trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn builds_agent_and_npm_environment_without_persisting_inline_credentials() {
        let profile = test_network_profile();
        let environment = profile_environment(&profile, Some("p@ss word")).unwrap();

        assert_eq!(
            environment.get("HTTPS_PROXY").map(String::as_str),
            Some("http://build-user:p%40ss%20word@127.0.0.1:8080/")
        );
        assert_eq!(
            environment.get("NPM_CONFIG_REGISTRY").map(String::as_str),
            Some("https://registry.internal.example/npm/")
        );
        assert_eq!(
            environment.get("NO_PROXY").map(String::as_str),
            Some("localhost,.internal.example")
        );
        // npm's own noproxy takes precedence over NO_PROXY, so both have to carry the list.
        assert_eq!(
            environment.get("NPM_CONFIG_NOPROXY").map(String::as_str),
            Some("localhost,.internal.example")
        );
        assert_eq!(
            environment.get("NPM_CONFIG_STRICT_SSL").map(String::as_str),
            Some("false")
        );
    }

    #[test]
    fn converts_system_bypass_syntax_for_npm() {
        assert_eq!(
            npm_no_proxy(
                "*.corp.example;registry.corp.example:4873;<local>;LOCALHOST;::1;[2001:db8::1]:8080"
            )
            .as_deref(),
            Some(
                ".corp.example,registry.corp.example,localhost,127.0.0.1,[::1],[2001:db8::1]"
            )
        );
    }

    #[test]
    fn converts_url_entries_and_keeps_system_no_proxy_unchanged() {
        let mut profile = test_network_profile();
        profile.no_proxy = Some("https://registry.internal:4873/path;*.corp".into());

        let environment = profile_environment(&profile, Some("p@ss word")).unwrap();

        assert_eq!(
            environment.get("NO_PROXY").map(String::as_str),
            Some("https://registry.internal:4873/path;*.corp")
        );
        assert_eq!(
            environment.get("NPM_CONFIG_NOPROXY").map(String::as_str),
            Some("registry.internal,.corp")
        );
    }

    #[test]
    fn passes_a_proxy_without_credentials_through_unchanged() {
        // `http://host:8080/` is not the same address to every HTTP client: the trailing slash
        // reads as a path and makes requests stall, which is why the entered value is kept.
        let mut profile = test_network_profile();
        profile.proxy_username = None;
        profile.https_proxy = Some("http://proxy.corp.example:8080".into());
        profile.http_proxy = Some("http://proxy.corp.example:8080".into());

        let environment = profile_environment(&profile, None).unwrap();

        assert_eq!(
            environment.get("HTTPS_PROXY").map(String::as_str),
            Some("http://proxy.corp.example:8080")
        );
        assert_eq!(
            environment.get("http_proxy").map(String::as_str),
            Some("http://proxy.corp.example:8080")
        );
    }

    #[test]
    fn rejects_a_proxy_declared_over_tls() {
        // `https://host:7890` makes the client attempt a TLS handshake with the proxy port
        // itself, which plain proxies drop — the agent then hangs until its request times out.
        let mut profile = test_network_profile();
        profile.https_proxy = Some("https://127.0.0.1:7890".into());

        let error = validate_profile(&profile).unwrap_err();

        assert!(error.contains("https://"));
        assert!(error.contains("http://127.0.0.1:7890"));
    }

    #[test]
    fn keeps_accepting_an_http_proxy_for_https_traffic() {
        let mut profile = test_network_profile();
        profile.https_proxy = Some("http://127.0.0.1:7890".into());

        assert!(validate_profile(&profile).is_ok());
    }

    #[test]
    fn rejects_inline_proxy_credentials() {
        let mut profile = test_network_profile();
        profile.https_proxy = Some("http://user:secret@proxy.example:8080".into());

        assert!(validate_profile(&profile)
            .unwrap_err()
            .contains("不能在 URL 中保存账号密码"));
    }

    /// Runs a one-shot proxy answering CONNECT with `response`, then optionally replying to the
    /// tunnelled TLS ClientHello with `tunnel_reply`.
    fn spawn_proxy(
        response: &'static str,
        tunnel_reply: Option<&'static [u8]>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 128];
            let _ = stream.read(&mut buffer);
            let _ = stream.write_all(response.as_bytes());
            if let Some(reply) = tunnel_reply {
                let mut hello = [0u8; 512];
                let _ = stream.read(&mut hello);
                let _ = stream.write_all(reply);
            }
        });
        (format!("http://{address}"), handle)
    }

    /// First bytes of a TLS ServerHello record.
    const TLS_SERVER_HELLO: &[u8] = &[0x16, 0x03, 0x03, 0x00, 0x2a];
    /// A fatal handshake_failure alert, which real endpoints send when they reject the probe's
    /// single legacy cipher suite. The tunnel is still proven to work.
    const TLS_HANDSHAKE_ALERT: &[u8] = &[0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x28];

    #[test]
    fn reports_a_proxy_that_opens_the_tunnel_as_healthy() {
        let (proxy, handle) = spawn_proxy(
            "HTTP/1.1 200 Connection established\r\n\r\n",
            Some(TLS_SERVER_HELLO),
        );
        let mut profile = test_network_profile();
        profile.https_proxy = Some(proxy.clone());

        let result = test_profile(&profile, None).unwrap();

        assert!(result.healthy);
        assert_eq!(result.target, proxy);
        assert!(result.message.contains(PROBE_HOST));
        handle.join().unwrap();
    }

    #[test]
    fn accepts_a_destination_that_rejects_the_probe_handshake() {
        // api.anthropic.com answers the minimal ClientHello with handshake_failure. That is a
        // reachable endpoint, not a broken proxy.
        let (proxy, handle) = spawn_proxy(
            "HTTP/1.1 200 Connection established\r\n\r\n",
            Some(TLS_HANDSHAKE_ALERT),
        );
        let mut profile = test_network_profile();
        profile.https_proxy = Some(proxy);

        let result = test_profile(&profile, None).unwrap();

        assert!(result.healthy);
        handle.join().unwrap();
    }

    #[test]
    fn rejects_a_tunnel_that_never_reaches_the_destination() {
        // Rule-based proxies answer 200 before resolving the target, so a dead route looks
        // identical to a working one until the tunnel is actually used.
        let (proxy, handle) = spawn_proxy("HTTP/1.1 200 Connection established\r\n\r\n", None);
        let mut profile = test_network_profile();
        profile.https_proxy = Some(proxy);

        let result = test_profile(&profile, None).unwrap();

        assert!(!result.healthy);
        assert!(result.message.contains("无法到达"));
        handle.join().unwrap();
    }

    #[test]
    fn reports_a_proxy_demanding_authentication() {
        // Reaching this proxy succeeds, so the old TCP-only probe called it healthy while
        // agents hung on every request.
        let (proxy, handle) =
            spawn_proxy("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n", None);
        let mut profile = test_network_profile();
        profile.https_proxy = Some(proxy);

        let result = test_profile(&profile, None).unwrap();

        assert!(!result.healthy);
        assert!(result.message.contains("407"));
        handle.join().unwrap();
    }

    #[test]
    fn reports_a_proxy_that_refuses_the_destination() {
        let (proxy, handle) = spawn_proxy("HTTP/1.1 403 Forbidden\r\n\r\n", None);
        let mut profile = test_network_profile();
        profile.https_proxy = Some(proxy);

        let result = test_profile(&profile, None).unwrap();

        assert!(!result.healthy);
        assert!(result.message.contains("403"));
        handle.join().unwrap();
    }

    fn test_network_profile() -> NetworkProfile {
        NetworkProfile {
            id: "network-1".into(),
            name: "Internal network".into(),
            scope: "global".into(),
            workspace_id: None,
            enabled: true,
            is_default: true,
            http_proxy: None,
            https_proxy: Some("http://127.0.0.1:8080".into()),
            all_proxy: None,
            no_proxy: Some("localhost,.internal.example".into()),
            npm_registry: Some("https://registry.internal.example/npm/".into()),
            npm_proxy: None,
            npm_https_proxy: Some("http://127.0.0.1:8080".into()),
            npm_strict_ssl: false,
            npm_ca_path: Some("C:\\certs\\internal-ca.pem".into()),
            proxy_username: Some("build-user".into()),
            credential_target: Some("network-profile:network-1".into()),
            has_credential: true,
        }
    }
}
