//! The long-lived credential a relay issues to a device: `tdc1.<deviceId>.<secret>`.
//!
//! The relay only ever stores the secret's SHA-256, so a leaked database cannot impersonate a
//! device. The digest is a plain one on purpose: the secret is 32 random bytes, which leaves
//! nothing for a slow hash to protect against.

use std::fmt;

use data_encoding::{BASE32_NOPAD, HEXLOWER};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::secret::{random_base64url, tokens_match};
use crate::REDACTED_PLACEHOLDER;

/// Version tag of the credential format; a future format gets `tdc2` rather than a new field.
pub const CREDENTIAL_PREFIX: &str = "tdc1";

/// Separates the prefix, the device id and the secret. Neither base32 nor base64url produces it.
const CREDENTIAL_SEPARATOR: char = '.';
/// 128 bits of randomness makes a device id globally unique without a registry, so a cascade never
/// has to rename a device it did not issue.
const DEVICE_ID_BYTES: usize = 16;
/// The base32 rendering of [`DEVICE_ID_BYTES`] without padding.
const DEVICE_ID_LENGTH: usize = 26;
const SECRET_BYTES: usize = 32;

/// Why a credential could not be produced or read. The text reaches the desktop panel and the
/// relay's responses, so it is user-facing.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CredentialError {
    #[error("无法生成设备凭据：{0}")]
    Random(String),
    #[error("设备凭据格式不正确。")]
    Malformed,
    #[error("设备标识不是合法的设备 id。")]
    InvalidDeviceId,
    #[error("设备凭据缺少密钥。")]
    MissingSecret,
}

/// A device's public identifier. It is also the path segment in `/d/<deviceId>/`, which is why it
/// is short, lowercase base32 and free of characters a URL would escape.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DeviceId(String);

impl DeviceId {
    pub fn generate() -> Result<Self, CredentialError> {
        let mut bytes = [0_u8; DEVICE_ID_BYTES];
        getrandom::fill(&mut bytes).map_err(|error| CredentialError::Random(error.to_string()))?;
        Ok(Self(BASE32_NOPAD.encode(&bytes).to_lowercase()))
    }

    pub fn parse(value: &str) -> Result<Self, CredentialError> {
        if value.len() != DEVICE_ID_LENGTH || !value.bytes().all(is_device_id_byte) {
            return Err(CredentialError::InvalidDeviceId);
        }
        Ok(Self(value.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DeviceId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The lowercase RFC 4648 base32 alphabet. Uppercase is refused rather than folded: the id is
/// generated in one spelling, so a different one is a sign of a mangled link, not of a variant.
const fn is_device_id_byte(byte: u8) -> bool {
    matches!(byte, b'a'..=b'z' | b'2'..=b'7')
}

/// What the desktop app keeps in its credential store and presents to open a tunnel.
#[derive(Clone, PartialEq, Eq)]
pub struct DeviceCredential {
    pub device_id: DeviceId,
    pub secret: String,
}

impl DeviceCredential {
    pub fn generate() -> Result<Self, CredentialError> {
        Ok(Self {
            device_id: DeviceId::generate()?,
            secret: random_base64url(SECRET_BYTES).map_err(CredentialError::Random)?,
        })
    }

    pub fn parse(value: &str) -> Result<Self, CredentialError> {
        let mut parts = value.split(CREDENTIAL_SEPARATOR);
        let (Some(prefix), Some(device_id), Some(secret)) =
            (parts.next(), parts.next(), parts.next())
        else {
            return Err(CredentialError::Malformed);
        };
        if prefix != CREDENTIAL_PREFIX || parts.next().is_some() {
            return Err(CredentialError::Malformed);
        }
        if secret.is_empty() {
            return Err(CredentialError::MissingSecret);
        }
        Ok(Self {
            device_id: DeviceId::parse(device_id)?,
            secret: secret.to_string(),
        })
    }

    /// What the relay stores in `devices.secret_hash`.
    pub fn secret_hash(&self) -> String {
        hash_secret(&self.secret)
    }
}

impl fmt::Display for DeviceCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{CREDENTIAL_PREFIX}{CREDENTIAL_SEPARATOR}{}{CREDENTIAL_SEPARATOR}{}",
            self.device_id, self.secret
        )
    }
}

/// Written by hand so a credential that ends up in a log line or a `Debug`-formatted error never
/// carries its secret with it. Use `Display` when the real credential is wanted.
impl fmt::Debug for DeviceCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceCredential")
            .field("device_id", &self.device_id)
            .field("secret", &REDACTED_PLACEHOLDER)
            .finish()
    }
}

/// Hashes a secret into the lowercase hex digest the relay stores.
pub fn hash_secret(secret: &str) -> String {
    HEXLOWER.encode(&Sha256::digest(secret.as_bytes()))
}

/// Whether a presented secret hashes to a stored digest, compared in constant time.
pub fn secret_matches_hash(secret: &str, hash: &str) -> bool {
    tokens_match(hash, &hash_secret(secret))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_device_ids_are_lowercase_base32_and_unique() {
        let first = DeviceId::generate().expect("an id should be generated");
        let second = DeviceId::generate().expect("an id should be generated");

        assert_ne!(first, second);
        assert_eq!(first.as_str().len(), DEVICE_ID_LENGTH);
        assert!(first.as_str().bytes().all(is_device_id_byte));
        assert_eq!(DeviceId::parse(first.as_str()), Ok(first));
    }

    #[test]
    fn a_device_id_of_the_wrong_shape_is_refused() {
        let valid = DeviceId::generate().expect("an id should be generated");
        let rejected = [
            String::new(),
            valid.as_str()[..DEVICE_ID_LENGTH - 1].to_string(),
            format!("{valid}a"),
            valid.as_str().to_uppercase(),
            // '1', '8', '9' and '0' are outside the base32 alphabet.
            format!("{}1", &valid.as_str()[..DEVICE_ID_LENGTH - 1]),
        ];

        for value in rejected {
            assert_eq!(
                DeviceId::parse(&value),
                Err(CredentialError::InvalidDeviceId),
                "{value} should not parse"
            );
        }
    }

    #[test]
    fn a_credential_survives_a_display_round_trip() {
        let credential = DeviceCredential::generate().expect("a credential should be generated");

        let parsed = DeviceCredential::parse(&credential.to_string())
            .expect("the credential should parse back");

        assert_eq!(parsed, credential);
        assert!(credential
            .to_string()
            .starts_with(&format!("{CREDENTIAL_PREFIX}{CREDENTIAL_SEPARATOR}")));
    }

    #[test]
    fn a_credential_with_a_bad_prefix_or_shape_is_refused() {
        let credential = DeviceCredential::generate().expect("a credential should be generated");
        let rendered = credential.to_string();

        assert_eq!(
            DeviceCredential::parse(&format!(
                "tdc2.{}.{}",
                credential.device_id, credential.secret
            )),
            Err(CredentialError::Malformed)
        );
        assert_eq!(
            DeviceCredential::parse(&format!("{rendered}.extra")),
            Err(CredentialError::Malformed)
        );
        assert_eq!(
            DeviceCredential::parse(&format!("{CREDENTIAL_PREFIX}.{}", credential.device_id)),
            Err(CredentialError::Malformed)
        );
        assert_eq!(
            DeviceCredential::parse(&format!("{CREDENTIAL_PREFIX}.{}.", credential.device_id)),
            Err(CredentialError::MissingSecret)
        );
        assert_eq!(
            DeviceCredential::parse(&format!(
                "{CREDENTIAL_PREFIX}.not-an-id.{}",
                credential.secret
            )),
            Err(CredentialError::InvalidDeviceId)
        );
    }

    #[test]
    fn the_debug_output_never_carries_the_secret() {
        let credential = DeviceCredential::generate().expect("a credential should be generated");

        let rendered = format!("{credential:?}");

        assert!(!rendered.contains(&credential.secret));
        assert!(rendered.contains(credential.device_id.as_str()));
        assert!(rendered.contains(REDACTED_PLACEHOLDER));
    }

    #[test]
    fn a_secret_matches_only_its_own_digest() {
        let credential = DeviceCredential::generate().expect("a credential should be generated");
        let hash = credential.secret_hash();

        assert_eq!(hash.len(), 64);
        assert!(secret_matches_hash(&credential.secret, &hash));
        assert!(!secret_matches_hash("wrong", &hash));
        // An empty stored digest must never match, so a half-written row cannot let anyone in.
        assert!(!secret_matches_hash(&credential.secret, ""));
    }

    #[test]
    fn hashing_is_stable_and_lowercase_hex() {
        // The digest of the empty string, so a future change of hash or encoding is caught here.
        assert_eq!(
            hash_secret(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}
