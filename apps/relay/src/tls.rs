//! TLS material: a persisted self-signed certificate, a certificate from disk, or none at all.

use std::fs;
use std::path::{Path, PathBuf};

use axum_server::tls_rustls::RustlsConfig;
use data_encoding::{BASE64, HEXUPPER};
use sha2::{Digest, Sha256};

use crate::config::TlsMode;

/// The certificate lives next to the database so a device that pinned its fingerprint keeps
/// trusting it across restarts.
const TLS_DIRECTORY: &str = "tls";
const CERTIFICATE_FILE: &str = "cert.pem";
const PRIVATE_KEY_FILE: &str = "key.pem";

/// Always in the SAN list, so `https://localhost:8443` works on the relay's own host.
const LOCALHOST_NAME: &str = "localhost";

const CERTIFICATE_PEM_HEADER: &str = "-----BEGIN CERTIFICATE-----";
const CERTIFICATE_PEM_FOOTER: &str = "-----END CERTIFICATE-----";

/// Builds the listener's TLS configuration, or `None` for plain HTTP.
pub async fn configure(
    mode: &TlsMode,
    data_directory: &Path,
    public_host_name: &str,
) -> Result<Option<RustlsConfig>, String> {
    match mode {
        TlsMode::Disabled => Ok(None),
        TlsMode::Certificate { chain, key } => {
            let material = PemMaterial {
                certificate: read_file(chain)?,
                private_key: read_file(key)?,
            };
            Ok(Some(load(material).await?))
        }
        TlsMode::SelfSigned => {
            let material = load_or_generate(data_directory, public_host_name)?;
            // A self-signed relay is pinned by fingerprint on the desktop side, so the operator has
            // to be able to read it off the log once.
            tracing::info!(
                fingerprint = %certificate_fingerprint(&material.certificate)
                    .unwrap_or_else(|| "<无法计算>".into()),
                "自签名证书指纹（SHA-256）"
            );
            Ok(Some(load(material).await?))
        }
    }
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

/// Reuses the persisted certificate, generating a new one only when there is none.
fn load_or_generate(data_directory: &Path, public_host_name: &str) -> Result<PemMaterial, String> {
    let directory = data_directory.join(TLS_DIRECTORY);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建证书目录 {}：{error}", directory.display()))?;

    let paths = MaterialPaths::new(&directory);
    if let Some(material) = paths.read() {
        return Ok(material);
    }
    let material = generate(public_host_name)?;
    paths.write(&material)?;
    Ok(material)
}

fn generate(public_host_name: &str) -> Result<PemMaterial, String> {
    let certified = rcgen::generate_simple_self_signed(subject_alt_names(public_host_name))
        .map_err(|error| format!("无法生成自签名证书：{error}"))?;
    Ok(PemMaterial {
        certificate: certified.cert.pem().into_bytes(),
        private_key: certified.signing_key.serialize_pem().into_bytes(),
    })
}

/// The names the certificate is valid for: the relay's public host and `localhost`.
///
/// rcgen turns an entry that parses as an IP address into an `iPAddress` SAN by itself, which is
/// what a browser checks when the relay is reached at `https://192.168.1.20:8443`.
fn subject_alt_names(public_host_name: &str) -> Vec<String> {
    let mut names = vec![LOCALHOST_NAME.to_string()];
    let host = public_host_name.trim();
    if !host.is_empty() && host != LOCALHOST_NAME {
        names.push(host.to_string());
    }
    names
}

async fn load(material: PemMaterial) -> Result<RustlsConfig, String> {
    RustlsConfig::from_pem(material.certificate, material.private_key)
        .await
        .map_err(|error| format!("无法加载 TLS 证书：{error}"))
}

fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("无法读取 {}：{error}", path.display()))
}

/// The SHA-256 of the leaf certificate's DER, in the colon-separated hex browsers and the desktop
/// panel both show.
fn certificate_fingerprint(certificate_pem: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(certificate_pem).ok()?;
    let start = text.find(CERTIFICATE_PEM_HEADER)? + CERTIFICATE_PEM_HEADER.len();
    let end = text.find(CERTIFICATE_PEM_FOOTER)?;
    let body: String = text.get(start..end)?.split_whitespace().collect();
    let der = BASE64.decode(body.as_bytes()).ok()?;
    Some(
        HEXUPPER
            .encode(&Sha256::digest(&der))
            .as_bytes()
            .chunks(2)
            .map(|pair| String::from_utf8_lossy(pair).into_owned())
            .collect::<Vec<_>>()
            .join(":"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_san_list_always_covers_localhost_without_duplicating_it() {
        assert_eq!(
            subject_alt_names("relay.example.com"),
            vec!["localhost".to_string(), "relay.example.com".to_string()]
        );
        assert_eq!(
            subject_alt_names("localhost"),
            vec!["localhost".to_string()]
        );
        assert_eq!(subject_alt_names("  "), vec!["localhost".to_string()]);
    }

    #[test]
    fn a_generated_certificate_has_a_readable_fingerprint() {
        let material = generate("relay.example.com").expect("a certificate should be generated");

        let fingerprint =
            certificate_fingerprint(&material.certificate).expect("it should be computable");

        // 32 bytes of SHA-256 rendered as `AB:CD:…`.
        assert_eq!(fingerprint.split(':').count(), 32);
        assert!(fingerprint
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == ':'));
        assert!(String::from_utf8_lossy(&material.private_key).contains("PRIVATE KEY-----"));
    }

    #[test]
    fn material_that_is_not_a_certificate_has_no_fingerprint() {
        assert_eq!(certificate_fingerprint(b"not a certificate"), None);
        assert_eq!(
            certificate_fingerprint(b"-----BEGIN CERTIFICATE-----\n!!!\n-----END CERTIFICATE-----"),
            None
        );
    }

    #[test]
    fn a_persisted_certificate_is_reused_rather_than_regenerated() {
        let directory = std::env::temp_dir().join(format!(
            "termexo-relay-tls-{}",
            crate::db::new_identifier()
                .expect("an id")
                .replace(['-', '_'], "")
        ));

        let first = load_or_generate(&directory, "relay.example.com").expect("it should generate");
        let second = load_or_generate(&directory, "relay.example.com").expect("it should reuse");

        assert_eq!(first.certificate, second.certificate);
        let _ = fs::remove_dir_all(&directory);
    }
}
