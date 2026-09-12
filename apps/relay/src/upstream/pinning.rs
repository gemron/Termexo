//! Trusting one upstream certificate by its digest.
//!
//! An upstream on a home or office network usually has no domain name and therefore a self-signed
//! certificate. Pinning its digest is a stronger promise than a public CA makes about a public
//! name, and it is the same decision the desktop panel makes about the relay it joins.
//!
//! The verifier is written here rather than in `termexo-relay-protocol` on purpose: that crate is
//! the wire format, and pulling a TLS stack into it would make every consumer carry one.

use std::sync::Arc;

use data_encoding::HEXLOWER;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error as TlsError, SignatureScheme};
use sha2::{Digest, Sha256};
use termexo_relay_protocol::secret::tokens_match;

const FINGERPRINT_MISMATCH: &str = "上游中继的证书指纹与已保存的不一致。";

/// The TLS configuration that pins one certificate, or `None` when the platform's own root store
/// is the one to decide.
pub fn client_config(fingerprint: Option<&str>) -> Option<ClientConfig> {
    fingerprint.map(|fingerprint| {
        // The provider is named rather than read from the process-wide default so a unit test,
        // which never runs the relay's start-up, builds the same configuration the relay does.
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        ClientConfig::builder_with_provider(provider.clone())
            .with_safe_default_protocol_versions()
            .expect("the bundled provider supports the default protocol versions")
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(PinnedCertificateVerifier {
                fingerprint: fingerprint.to_string(),
                provider,
            }))
            .with_no_client_auth()
    })
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
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(
            message,
            certificate,
            signature,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(
            message,
            certificate,
            signature,
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

    const PINNED: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    /// Without a stored fingerprint the platform's root store decides, which is what an upstream
    /// with a real certificate wants; the custom verifier only exists for the self-signed case.
    #[test]
    fn a_certificate_is_pinned_only_when_a_fingerprint_was_stored() {
        assert!(client_config(None).is_none());
        assert!(client_config(Some(PINNED)).is_some());
    }

    #[test]
    fn the_digest_is_the_lowercase_hex_of_the_certificate_bytes() {
        assert_eq!(
            certificate_fingerprint(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn a_certificate_is_accepted_only_when_its_digest_is_the_pinned_one() {
        let certificate = CertificateDer::from(b"upstream-certificate".to_vec());
        let verifier = PinnedCertificateVerifier {
            fingerprint: certificate_fingerprint(&certificate),
            provider: Arc::new(rustls::crypto::aws_lc_rs::default_provider()),
        };
        let name = ServerName::try_from("relay-a.example.com").expect("a valid name");

        assert!(verifier
            .verify_server_cert(&certificate, &[], &name, &[], UnixTime::now())
            .is_ok());
        assert!(verifier
            .verify_server_cert(
                &CertificateDer::from(b"another-certificate".to_vec()),
                &[],
                &name,
                &[],
                UnixTime::now()
            )
            .is_err());
    }
}
