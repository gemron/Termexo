use std::fs;
use std::path::{Path, PathBuf};

use axum_server::tls_rustls::RustlsConfig;

/// PEM material lives next to the database rather than in a temporary directory: the phone that
/// accepted the certificate once must keep trusting it across restarts.
const TLS_DIRECTORY: &str = "remote";
const CERTIFICATE_FILE: &str = "cert.pem";
const PRIVATE_KEY_FILE: &str = "key.pem";

/// Always in the SAN list so `https://localhost:<port>` works from the machine itself.
const LOCALHOST_NAME: &str = "localhost";

/// Returns a TLS configuration backed by the persisted self-signed certificate.
///
/// The certificate is reused whenever it still parses, so a device that trusted it once is not
/// asked again on the next launch. Material that no longer loads — truncated, or written by an
/// older format — is regenerated instead of failing the start.
pub async fn load_or_create_config(
    app_data_dir: &Path,
    host_addresses: &[String],
) -> Result<RustlsConfig, String> {
    let directory = app_data_dir.join(TLS_DIRECTORY);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建证书目录 {}：{error}", directory.display()))?;

    let paths = MaterialPaths::new(&directory);
    if let Some(material) = paths.read() {
        match RustlsConfig::from_pem(material.certificate, material.private_key).await {
            Ok(config) => return Ok(config),
            Err(error) => {
                tracing::warn!(%error, "已保存的远程访问证书无法加载，将重新生成");
            }
        }
    }

    let material = generate(host_addresses)?;
    paths.write(&material)?;
    RustlsConfig::from_pem(material.certificate, material.private_key)
        .await
        .map_err(|error| format!("无法加载自签名证书：{error}"))
}

struct PemMaterial {
    certificate: Vec<u8>,
    private_key: Vec<u8>,
}

struct MaterialPaths {
    certificate: PathBuf,
    private_key: PathBuf,
}

impl MaterialPaths {
    fn new(directory: &Path) -> Self {
        Self {
            certificate: directory.join(CERTIFICATE_FILE),
            private_key: directory.join(PRIVATE_KEY_FILE),
        }
    }

    fn read(&self) -> Option<PemMaterial> {
        Some(PemMaterial {
            certificate: fs::read(&self.certificate).ok()?,
            private_key: fs::read(&self.private_key).ok()?,
        })
    }

    fn write(&self, material: &PemMaterial) -> Result<(), String> {
        fs::write(&self.certificate, &material.certificate)
            .and_then(|_| fs::write(&self.private_key, &material.private_key))
            .map_err(|error| format!("无法保存自签名证书：{error}"))
    }
}

fn generate(host_addresses: &[String]) -> Result<PemMaterial, String> {
    let certified = rcgen::generate_simple_self_signed(subject_alt_names(host_addresses))
        .map_err(|error| format!("无法生成自签名证书：{error}"))?;
    Ok(PemMaterial {
        certificate: certified.cert.pem().into_bytes(),
        private_key: certified.signing_key.serialize_pem().into_bytes(),
    })
}

/// Builds the SAN list: `localhost`, the machine name, and every local IPv4 address.
///
/// rcgen turns an entry that parses as an IP address into an `iPAddress` SAN by itself, which is
/// what browsers check when the URL is `https://192.168.1.20:7420`.
fn subject_alt_names(host_addresses: &[String]) -> Vec<String> {
    let mut names = vec![LOCALHOST_NAME.to_string()];
    if let Some(host_name) = machine_name() {
        names.push(host_name);
    }
    names.extend(host_addresses.iter().cloned());
    names.sort();
    names.dedup();
    names
}

fn machine_name() -> Option<String> {
    let raw = if cfg!(windows) {
        std::env::var("COMPUTERNAME")
    } else {
        std::env::var("HOSTNAME")
    };
    raw.ok()
        .map(|name| name.trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty() && name != LOCALHOST_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn always_covers_localhost_and_every_supplied_address() {
        let names = subject_alt_names(&["192.168.1.20".into(), "127.0.0.1".into()]);

        assert!(names.contains(&LOCALHOST_NAME.to_string()));
        assert!(names.contains(&"192.168.1.20".to_string()));
        assert!(names.contains(&"127.0.0.1".to_string()));
    }

    #[test]
    fn duplicate_addresses_are_collapsed() {
        let names = subject_alt_names(&["192.168.1.20".into(), "192.168.1.20".into()]);

        assert_eq!(
            names
                .iter()
                .filter(|name| name.as_str() == "192.168.1.20")
                .count(),
            1
        );
    }

    #[test]
    fn generated_material_is_a_certificate_and_a_private_key() {
        let material = generate(&["127.0.0.1".into()]).expect("a certificate should be generated");

        let certificate = String::from_utf8(material.certificate).expect("PEM is UTF-8");
        let private_key = String::from_utf8(material.private_key).expect("PEM is UTF-8");
        assert!(certificate.starts_with("-----BEGIN CERTIFICATE-----"));
        assert!(private_key.contains("PRIVATE KEY-----"));
    }
}
