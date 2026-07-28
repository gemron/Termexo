use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Serialize;
use url::Url;

use crate::config::NetworkProfile;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
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
                drop(stream);
                return Ok(NetworkTestResult {
                    profile_id: profile.id.clone(),
                    healthy: true,
                    target: display_target,
                    message: "TCP 连通性测试通过".into(),
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
    if let Some(username) = username.map(str::trim).filter(|value| !value.is_empty()) {
        parsed
            .set_username(username)
            .map_err(|_| "代理用户名无法写入 URL".to_owned())?;
        parsed
            .set_password(password.filter(|value| !value.is_empty()))
            .map_err(|_| "代理密码无法写入 URL".to_owned())?;
    }
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
        assert_eq!(
            environment.get("NPM_CONFIG_STRICT_SSL").map(String::as_str),
            Some("false")
        );
    }

    #[test]
    fn rejects_inline_proxy_credentials() {
        let mut profile = test_network_profile();
        profile.https_proxy = Some("http://user:secret@proxy.example:8080".into());

        assert!(validate_profile(&profile)
            .unwrap_err()
            .contains("不能在 URL 中保存账号密码"));
    }

    #[test]
    fn tests_a_reachable_local_proxy_endpoint() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let accepted = thread::spawn(move || listener.accept().unwrap());
        let mut profile = test_network_profile();
        profile.https_proxy = Some(format!("http://{address}"));

        let result = test_profile(&profile, None).unwrap();

        assert!(result.healthy);
        assert_eq!(result.target, format!("http://{address}"));
        drop(accepted.join().unwrap());
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
