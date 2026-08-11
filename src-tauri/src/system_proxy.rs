//! Read-only discovery of proxy settings already active on the host.
//!
//! Environment variables win because they are the settings inherited by a CLI launched from the
//! current process. On Windows we then fall back to the user's Internet Settings registry key.

use std::env;
#[cfg(windows)]
use std::process::{Command, Stdio};

use serde::Serialize;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProxyDiscovery {
    pub source: String,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub all_proxy: Option<String>,
    pub no_proxy: Option<String>,
    pub diagnostic: String,
}

pub fn discover() -> Result<SystemProxyDiscovery, String> {
    let environment = discover_environment();
    if has_proxy(&environment) {
        return Ok(environment);
    }

    #[cfg(windows)]
    {
        return discover_windows_registry();
    }

    #[cfg(not(windows))]
    Err("未发现 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 或 NO_PROXY 环境变量。".into())
}

fn discover_environment() -> SystemProxyDiscovery {
    let http_proxy = environment_value("HTTP_PROXY");
    let https_proxy = environment_value("HTTPS_PROXY");
    let all_proxy = environment_value("ALL_PROXY");
    let no_proxy = environment_value("NO_PROXY");
    SystemProxyDiscovery {
        source: "environment".into(),
        http_proxy,
        https_proxy,
        all_proxy,
        no_proxy,
        diagnostic: "已读取当前进程继承的标准代理环境变量。".into(),
    }
}

fn environment_value(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .or_else(|| env::var(name.to_ascii_lowercase()).ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn has_proxy(discovery: &SystemProxyDiscovery) -> bool {
    discovery.http_proxy.is_some()
        || discovery.https_proxy.is_some()
        || discovery.all_proxy.is_some()
        || discovery.no_proxy.is_some()
}

#[cfg(windows)]
fn discover_windows_registry() -> Result<SystemProxyDiscovery, String> {
    let enabled = registry_value("ProxyEnable")?
        .is_some_and(|value| value.eq_ignore_ascii_case("0x1") || value == "1");
    if !enabled {
        return Err("Windows 系统代理未启用，且未发现标准代理环境变量。".into());
    }
    let server = registry_value("ProxyServer")?
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Windows 系统代理已启用，但 ProxyServer 为空。".to_owned())?;
    let overrides = registry_value("ProxyOverride")?;
    let mut discovery = parse_windows_proxy_server(&server);
    discovery.source = "windows".into();
    discovery.no_proxy = overrides.and_then(|value| normalize_proxy_override(&value));
    discovery.diagnostic = "已从 Windows 当前用户系统代理导入；代理密码不会被读取。".into();
    Ok(discovery)
}

#[cfg(windows)]
fn registry_value(name: &str) -> Result<Option<String>, String> {
    let mut command = Command::new("reg.exe");
    command.args([
        "query",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        "/v",
        name,
    ]);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
    let output = command
        .output()
        .map_err(|error| format!("无法读取 Windows 系统代理：{error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .lines()
        .find_map(|line| parse_registry_line(line, name)))
}

#[cfg(windows)]
fn parse_registry_line(line: &str, name: &str) -> Option<String> {
    let trimmed = line.trim();
    let remainder = trimmed.strip_prefix(name)?.trim_start();
    let remainder = remainder
        .strip_prefix("REG_SZ")
        .or_else(|| remainder.strip_prefix("REG_EXPAND_SZ"))
        .or_else(|| remainder.strip_prefix("REG_DWORD"))?
        .trim();
    (!remainder.is_empty()).then(|| remainder.to_owned())
}

fn parse_windows_proxy_server(value: &str) -> SystemProxyDiscovery {
    let mut discovery = SystemProxyDiscovery::default();
    if !value.contains('=') {
        let proxy = with_scheme(value, "http");
        discovery.http_proxy = proxy.clone();
        discovery.https_proxy = proxy;
        return discovery;
    }

    for entry in value
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        let Some((protocol, endpoint)) = entry.split_once('=') else {
            continue;
        };
        match protocol.trim().to_ascii_lowercase().as_str() {
            "http" => discovery.http_proxy = with_scheme(endpoint, "http"),
            "https" => discovery.https_proxy = with_scheme(endpoint, "http"),
            "socks" | "socks5" => discovery.all_proxy = with_scheme(endpoint, "socks5"),
            _ => {}
        }
    }
    discovery
}

fn with_scheme(value: &str, default_scheme: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else if value.contains("://") {
        Some(value.to_owned())
    } else {
        Some(format!("{default_scheme}://{value}"))
    }
}

fn normalize_proxy_override(value: &str) -> Option<String> {
    let mut entries = value
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty() && !entry.eq_ignore_ascii_case("<local>"))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if value
        .split(';')
        .any(|entry| entry.trim().eq_ignore_ascii_case("<local>"))
    {
        entries.extend(["localhost".into(), "127.0.0.1".into(), "::1".into()]);
    }
    entries.sort();
    entries.dedup();
    (!entries.is_empty()).then(|| entries.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_one_windows_proxy_for_http_and_https() {
        let result = parse_windows_proxy_server("proxy.corp:8080");
        assert_eq!(result.http_proxy.as_deref(), Some("http://proxy.corp:8080"));
        assert_eq!(result.https_proxy, result.http_proxy);
    }

    #[test]
    fn parses_protocol_specific_windows_proxy_settings() {
        let result = parse_windows_proxy_server(
            "http=proxy.corp:8080;https=secure.corp:8443;socks=127.0.0.1:1080",
        );
        assert_eq!(result.http_proxy.as_deref(), Some("http://proxy.corp:8080"));
        assert_eq!(
            result.https_proxy.as_deref(),
            Some("http://secure.corp:8443")
        );
        assert_eq!(result.all_proxy.as_deref(), Some("socks5://127.0.0.1:1080"));
    }

    #[test]
    fn converts_windows_bypass_entries_to_no_proxy() {
        let result = normalize_proxy_override("*.corp;<local>;localhost").unwrap();
        assert!(result.contains("*.corp"));
        assert!(result.contains("127.0.0.1"));
        assert!(result.contains("::1"));
    }

    #[cfg(windows)]
    #[test]
    fn parses_reg_query_output_without_depending_on_column_width() {
        assert_eq!(
            parse_registry_line("    ProxyEnable    REG_DWORD    0x1", "ProxyEnable").as_deref(),
            Some("0x1")
        );
    }
}
