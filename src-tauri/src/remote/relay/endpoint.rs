//! Where a relay is reached and how its certificate is trusted.
//!
//! The tunnel and the enrollment request go to the same host under the same trust decision, so
//! both derive their address and their TLS configuration from this one type.

use std::sync::Arc;

use data_encoding::HEXLOWER;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error as TlsError, SignatureScheme};
use sha2::{Digest, Sha256};
use termexo_relay_protocol::secret::tokens_match;
use termexo_relay_protocol::tunnel::{ENROLL_PATH, TUNNEL_PATH};

use crate::remote::settings::RelaySettings;

const HTTPS_SCHEME: &str = "https";
const SECURE_WEBSOCKET_SCHEME: &str = "wss";
const PLAIN_WEBSOCKET_SCHEME: &str = "ws";
const SCHEME_SEPARATOR: &str = "://";

/// Also how [`super::connect_failure`] recognizes this verifier's refusal inside a wrapped error.
pub(super) const FINGERPRINT_MISMATCH: &str = "中继证书指纹与已保存的不一致。";

/// One relay's address together with the trust decision that goes with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayEndpoint {
    /// Already normalized by [`RelaySettings`]: `http(s)://host[:port]`, no trailing slash.
    url: String,
    /// The pinned SHA-256 of the relay's leaf certificate, when the panel stored one.
    fingerprint: Option<String>,
}

impl RelayEndpoint {
    /// Builds an endpoint from settings that have already been through
    /// [`RelaySettings::normalized`].
    pub fn new(settings: &RelaySettings) -> Self {
        Self {
            url: settings.url.clone(),
            fingerprint: settings.certificate_fingerprint.clone(),
        }
    }

    /// The host and port, which is all a log line may carry about a relay.
    pub fn authority(&self) -> &str {
        self.split_scheme().1
    }

    pub fn enroll_url(&self) -> String {
        format!("{}{ENROLL_PATH}", self.url)
    }

    /// The tunnel's WebSocket address, over TLS whenever the relay itself is.
    pub fn tunnel_url(&self) -> String {
        let (scheme, authority) = self.split_scheme();
        let websocket_scheme = if scheme == HTTPS_SCHEME {
            SECURE_WEBSOCKET_SCHEME
        } else {
            PLAIN_WEBSOCKET_SCHEME
        };
        format!("{websocket_scheme}://{authority}{TUNNEL_PATH}")
    }

    /// The TLS configuration that pins this relay's certificate, or `None` when the platform's own
    /// root store is the one to decide.
    pub fn pinned_tls_config(&self) -> Option<ClientConfig> {
        self.fingerprint
            .as_deref()
            .map(|fingerprint| pinned_tls_config(fingerprint.to_string()))
    }

    fn split_scheme(&self) -> (&str, &str) {
        self.url
            .split_once(SCHEME_SEPARATOR)
            .unwrap_or((HTTPS_SCHEME, self.url.as_str()))
    }
}

/// Trusts exactly one certificate, identified by its digest.
///
/// This is what makes a relay on a home network usable without a public domain: the panel records
/// the fingerprint on the first enrollment and every later connection has to present the very same
/// certificate, which is a stronger promise than a public CA makes about a public name.
fn pinned_tls_config(fingerprint: String) -> ClientConfig {
    // The provider is named rather than read from the process-wide default so that a unit test,
    // which never runs the app's startup, builds the same configuration the app does.
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .expect("the bundled provider supports the default protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedCertificateVerifier {
            fingerprint,
            provider,
        }))
        .with_no_client_auth()
}

/// The SHA-256 of a DER certificate, in the lowercase hex spelling the settings store.
pub fn certificate_fingerprint(certificate: &[u8]) -> String {
    HEXLOWER.encode(&Sha256::digest(certificate))
}

#[derive(Debug)]
struct PinnedCertificateVerifier {
    fingerprint: String,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinnedCertificateVerifier {
    /// The chain, the name and the validity dates are all deliberately ignored: a pinned
    /// certificate is usually self-signed, issued to an address rather than a name, and kept well
    /// past a public CA's lifetime. The digest is the entire promise.
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        if tokens_match(&self.fingerprint, &certificate_fingerprint(end_entity)) {
            return Ok(ServerCertVerified::assertion());
        }
        Err(TlsError::General(FINGERPRINT_MISMATCH.into()))
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PINNED_FINGERPRINT: &str =
        "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    fn endpoint(url: &str, fingerprint: Option<&str>) -> RelayEndpoint {
        RelayEndpoint::new(
            &RelaySettings {
                enabled: true,
                url: url.into(),
                certificate_fingerprint: fingerprint.map(str::to_string),
            }
            .normalized()
            .expect("the test address should be valid"),
        )
    }

    #[test]
    fn the_tunnel_follows_the_relay_between_tls_and_plain_http() {
        assert_eq!(
            endpoint("https://relay.example.com", None).tunnel_url(),
            "wss://relay.example.com/tunnel"
        );
        assert_eq!(
            endpoint("http://192.168.1.20:8443", None).tunnel_url(),
            "ws://192.168.1.20:8443/tunnel"
        );
    }

    #[test]
    fn enrollment_posts_to_the_relays_own_api() {
        assert_eq!(
            endpoint("https://relay.example.com/", None).enroll_url(),
            "https://relay.example.com/api/enroll"
        );
    }

    #[test]
    fn only_the_host_and_port_are_exposed_for_logging() {
        assert_eq!(
            endpoint("https://relay.example.com:8443", None).authority(),
            "relay.example.com:8443"
        );
    }

    /// Without a stored fingerprint the platform's root store decides, which is what a relay with
    /// a real certificate wants; the custom verifier only exists for the self-signed case.
    #[test]
    fn a_certificate_is_pinned_only_when_a_fingerprint_was_stored() {
        assert!(endpoint("https://relay.example.com", None)
            .pinned_tls_config()
            .is_none());
        assert!(
            endpoint("https://relay.example.com", Some(PINNED_FINGERPRINT))
                .pinned_tls_config()
                .is_some()
        );
    }

    #[test]
    fn the_digest_is_the_lowercase_hex_of_the_certificate_bytes() {
        let fingerprint = certificate_fingerprint(b"");

        assert_eq!(
            fingerprint,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn a_certificate_is_accepted_only_when_its_digest_is_the_pinned_one() {
        let certificate = CertificateDer::from(b"relay-certificate".to_vec());
        let verifier = PinnedCertificateVerifier {
            fingerprint: certificate_fingerprint(&certificate),
            provider: Arc::new(rustls::crypto::aws_lc_rs::default_provider()),
        };
        let name = ServerName::try_from("relay.example.com").expect("a valid name");

        assert!(verifier
            .verify_server_cert(&certificate, &[], &name, &[], UnixTime::now())
            .is_ok());

        let other = CertificateDer::from(b"another-certificate".to_vec());
        assert!(verifier
            .verify_server_cert(&other, &[], &name, &[], UnixTime::now())
            .is_err());
    }
}
