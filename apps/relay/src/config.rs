//! Command line and environment configuration.
//!
//! Every option has a `TERMEXO_RELAY_*` environment equivalent so the Docker image can be driven
//! without a command line, and every value is resolved into a plain struct here rather than being
//! re-parsed deeper in the service.

use std::fmt;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::str::FromStr;

use clap::{Args, Parser, Subcommand};
use ipnet::IpNet;
use thiserror::Error;

/// Where the relay listens when nothing says otherwise. 8443 keeps it off the privileged range so
/// the container does not need extra capabilities.
pub const DEFAULT_LISTEN_ADDRESS: &str = "0.0.0.0:8443";
/// Relative on purpose: an absolute Unix path would be wrong on a developer's Windows machine, and
/// the Dockerfile sets `TERMEXO_RELAY_DATA_DIR` to `/var/lib/termexo-relay` anyway.
pub const DEFAULT_DATA_DIRECTORY: &str = "relay-data";
/// The account created on a database that has no users yet.
pub const DEFAULT_ADMIN_USERNAME: &str = "admin";

const SELF_SIGNED_MODE: &str = "self-signed";
const DISABLED_MODE: &str = "off";
const CERTIFICATE_MODE_PREFIX: &str = "cert:";
/// Separates the certificate chain from the private key in `cert:<crt>,<key>`.
const CERTIFICATE_PATH_SEPARATOR: char = ',';

const HTTPS_SCHEME: &str = "https://";
const HTTP_SCHEME: &str = "http://";

#[derive(Debug, Parser)]
#[command(
    name = "termexo-relay",
    version,
    about = "Termexo 中继服务：设备隧道、公开反向代理与管理控制台"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// 启动中继服务。
    Serve(ServeArgs),
    /// 用上游中继签发的接入码建立上游链接，只写入配置，不启动服务。
    Link(LinkArgs),
    /// 管理操作。
    Admin {
        #[command(subcommand)]
        command: AdminCommand,
    },
}

#[derive(Debug, Args)]
pub struct LinkArgs {
    #[arg(long, env = "TERMEXO_RELAY_DATA_DIR", default_value = DEFAULT_DATA_DIRECTORY)]
    pub data_dir: PathBuf,
    /// 上游中继的公开地址，例如 https://relay-a.example.com。
    #[arg(long)]
    pub upstream: String,
    /// 上游中继签发的、类型为 relay 的接入码。
    #[arg(long)]
    pub code: String,
    /// 本中继在上游中继上显示的名称，默认取本中继已保存的公开地址主机名。
    #[arg(long)]
    pub name: Option<String>,
}

#[derive(Debug, Subcommand)]
pub enum AdminCommand {
    /// 重置一个控制台账号的密码，新密码打印到终端。
    ResetPassword(ResetPasswordArgs),
}

#[derive(Debug, Args)]
pub struct ResetPasswordArgs {
    #[arg(long, env = "TERMEXO_RELAY_DATA_DIR", default_value = DEFAULT_DATA_DIRECTORY)]
    pub data_dir: PathBuf,
    #[arg(long, default_value = DEFAULT_ADMIN_USERNAME)]
    pub username: String,
}

#[derive(Debug, Args)]
pub struct ServeArgs {
    /// 数据目录：SQLite 数据库与自签名证书都放在这里。
    #[arg(long, env = "TERMEXO_RELAY_DATA_DIR", default_value = DEFAULT_DATA_DIRECTORY)]
    pub data_dir: PathBuf,
    /// 监听地址。
    #[arg(long, env = "TERMEXO_RELAY_LISTEN", default_value = DEFAULT_LISTEN_ADDRESS)]
    pub listen: SocketAddr,
    /// 浏览器访问中继用的公开地址，例如 https://relay.example.com。
    #[arg(long, env = "TERMEXO_RELAY_PUBLIC_URL")]
    pub public_url: Option<PublicUrl>,
    /// TLS 模式：self-signed、cert:<证书>,<私钥> 或 off。
    #[arg(long, env = "TERMEXO_RELAY_TLS", default_value = SELF_SIGNED_MODE)]
    pub tls: TlsMode,
    /// 受信任的反向代理网段，可重复。仅在 --tls off 时用于读取反代传来的转发头。
    #[arg(long = "trusted-proxy", env = "TERMEXO_RELAY_TRUSTED_PROXY", value_delimiter = ',', num_args = 1..)]
    pub trusted_proxy: Vec<IpNet>,
}

impl ServeArgs {
    /// Resolves the public URL, falling back to the address the relay listens on.
    ///
    /// A relay without a domain name still has to hand its devices *some* address, and the listen
    /// address is the only thing known at that point.
    pub fn resolved_public_url(&self) -> PublicUrl {
        self.public_url
            .clone()
            .unwrap_or_else(|| PublicUrl::from_listen_address(self.listen, self.tls.is_secure()))
    }
}

/// How the listener terminates TLS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TlsMode {
    /// Generate (and persist) a certificate of our own; for relays without a domain name.
    SelfSigned,
    /// Load a chain and key from disk; for a relay with a real certificate.
    Certificate { chain: PathBuf, key: PathBuf },
    /// Plain HTTP, for a relay that sits behind Caddy or nginx.
    Disabled,
}

impl TlsMode {
    pub fn is_secure(&self) -> bool {
        !matches!(self, Self::Disabled)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ConfigError {
    #[error("TLS 模式无法识别：{0}。可用值为 self-signed、cert:<证书>,<私钥> 或 off。")]
    UnknownTlsMode(String),
    #[error("cert: 模式需要写成 cert:<证书路径>,<私钥路径>。")]
    MalformedCertificateMode,
    #[error("公开地址必须以 http:// 或 https:// 开头。")]
    UnsupportedScheme,
    #[error("公开地址缺少主机名。")]
    MissingHost,
    #[error("公开地址不能带路径、查询串或片段：{0}")]
    UnexpectedPath(String),
}

impl FromStr for TlsMode {
    type Err = ConfigError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            SELF_SIGNED_MODE => Ok(Self::SelfSigned),
            DISABLED_MODE => Ok(Self::Disabled),
            _ => {
                let paths = value
                    .strip_prefix(CERTIFICATE_MODE_PREFIX)
                    .ok_or_else(|| ConfigError::UnknownTlsMode(value.to_string()))?;
                let (chain, key) = paths
                    .split_once(CERTIFICATE_PATH_SEPARATOR)
                    .ok_or(ConfigError::MalformedCertificateMode)?;
                if chain.is_empty() || key.is_empty() {
                    return Err(ConfigError::MalformedCertificateMode);
                }
                Ok(Self::Certificate {
                    chain: PathBuf::from(chain),
                    key: PathBuf::from(key),
                })
            }
        }
    }
}

/// The origin browsers reach the relay at, kept normalized so every address the relay hands out is
/// built the same way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicUrl {
    origin: String,
    host: String,
    secure: bool,
}

impl PublicUrl {
    /// The origin without a trailing slash, for example `https://relay.example.com`.
    pub fn origin(&self) -> &str {
        &self.origin
    }

    /// The host (with the port when it is not the scheme default), used as the certificate's
    /// subject name and as the relay's display name in an address list.
    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn is_secure(&self) -> bool {
        self.secure
    }

    /// The host without its port, which is what belongs in a certificate's SAN list.
    pub fn host_name(&self) -> &str {
        match self.host.rsplit_once(':') {
            // An IPv6 literal keeps its brackets and has no port to strip here.
            Some((name, _)) if !self.host.ends_with(']') => name,
            _ => &self.host,
        }
    }

    fn from_listen_address(listen: SocketAddr, secure: bool) -> Self {
        let scheme = if secure { HTTPS_SCHEME } else { HTTP_SCHEME };
        // 0.0.0.0 is not reachable as an address, so the loopback name is the honest stand-in until
        // the operator supplies a real public URL.
        let host = if listen.ip().is_unspecified() {
            format!("localhost:{}", listen.port())
        } else {
            listen.to_string()
        };
        Self {
            origin: format!("{scheme}{host}"),
            host,
            secure,
        }
    }
}

impl fmt::Display for PublicUrl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.origin)
    }
}

impl FromStr for PublicUrl {
    type Err = ConfigError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let trimmed = value.trim();
        let (secure, rest) = match (
            trimmed.strip_prefix(HTTPS_SCHEME),
            trimmed.strip_prefix(HTTP_SCHEME),
        ) {
            (Some(rest), _) => (true, rest),
            (None, Some(rest)) => (false, rest),
            _ => return Err(ConfigError::UnsupportedScheme),
        };
        // The trailing slash is trimmed after the scheme, or `https://` would lose its own slashes
        // and read as an unknown scheme instead of a missing host.
        let rest = rest.trim_end_matches('/');
        if let Some(index) = rest.find(['/', '?', '#']) {
            return Err(ConfigError::UnexpectedPath(rest[index..].to_string()));
        }
        if rest.is_empty() {
            return Err(ConfigError::MissingHost);
        }
        let scheme = if secure { HTTPS_SCHEME } else { HTTP_SCHEME };
        Ok(Self {
            origin: format!("{scheme}{rest}"),
            host: rest.to_string(),
            secure,
        })
    }
}

/// Whether a source address is one of the reverse proxies allowed to speak for its clients.
pub fn is_trusted_proxy(networks: &[IpNet], source: std::net::IpAddr) -> bool {
    networks.iter().any(|network| network.contains(&source))
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use super::*;

    #[test]
    fn tls_modes_parse_from_their_command_line_spellings() {
        assert_eq!(TlsMode::from_str("self-signed"), Ok(TlsMode::SelfSigned));
        assert_eq!(TlsMode::from_str("off"), Ok(TlsMode::Disabled));
        assert_eq!(
            TlsMode::from_str("cert:/etc/full.pem,/etc/key.pem"),
            Ok(TlsMode::Certificate {
                chain: PathBuf::from("/etc/full.pem"),
                key: PathBuf::from("/etc/key.pem"),
            })
        );
    }

    #[test]
    fn a_malformed_tls_mode_is_refused() {
        assert_eq!(
            TlsMode::from_str("cert:/etc/full.pem"),
            Err(ConfigError::MalformedCertificateMode)
        );
        assert_eq!(
            TlsMode::from_str("cert:,"),
            Err(ConfigError::MalformedCertificateMode)
        );
        assert!(matches!(
            TlsMode::from_str("acme"),
            Err(ConfigError::UnknownTlsMode(_))
        ));
    }

    #[test]
    fn a_public_url_is_normalized_to_an_origin() {
        let url = PublicUrl::from_str("https://relay.example.com/").expect("it should parse");

        assert_eq!(url.origin(), "https://relay.example.com");
        assert_eq!(url.host(), "relay.example.com");
        assert_eq!(url.host_name(), "relay.example.com");
        assert!(url.is_secure());
    }

    #[test]
    fn a_public_url_keeps_its_port_and_drops_it_from_the_certificate_name() {
        let url = PublicUrl::from_str("http://192.168.1.20:8443").expect("it should parse");

        assert_eq!(url.origin(), "http://192.168.1.20:8443");
        assert_eq!(url.host(), "192.168.1.20:8443");
        assert_eq!(url.host_name(), "192.168.1.20");
        assert!(!url.is_secure());
    }

    #[test]
    fn a_public_url_with_a_path_or_an_unknown_scheme_is_refused() {
        assert_eq!(
            PublicUrl::from_str("ftp://relay.example.com"),
            Err(ConfigError::UnsupportedScheme)
        );
        assert_eq!(
            PublicUrl::from_str("https://"),
            Err(ConfigError::MissingHost)
        );
        assert!(matches!(
            PublicUrl::from_str("https://relay.example.com/console"),
            Err(ConfigError::UnexpectedPath(_))
        ));
    }

    #[test]
    fn an_unspecified_listen_address_falls_back_to_localhost() {
        let url = PublicUrl::from_listen_address("0.0.0.0:8443".parse().expect("valid"), true);

        assert_eq!(url.origin(), "https://localhost:8443");
    }

    #[test]
    fn only_a_configured_network_counts_as_a_trusted_proxy() {
        let networks = vec![
            "10.0.0.0/8".parse().expect("valid"),
            "127.0.0.1/32".parse().expect("valid"),
        ];

        assert!(is_trusted_proxy(
            &networks,
            IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3))
        ));
        assert!(is_trusted_proxy(
            &networks,
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))
        ));
        assert!(!is_trusted_proxy(
            &networks,
            IpAddr::V4(Ipv4Addr::new(203, 0, 113, 5))
        ));
        assert!(!is_trusted_proxy(&[], IpAddr::V4(Ipv4Addr::LOCALHOST)));
    }
}
