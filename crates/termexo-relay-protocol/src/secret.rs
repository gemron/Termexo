//! Random secrets and constant-time comparison, shared by the workbench access token, the device
//! credential's secret and the relay's enrollment codes.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use subtle::ConstantTimeEq;

/// 32 random bytes is the same strength as a v4 UUID's entropy plus a wide margin, and base64url
/// keeps the token safe to carry in a URL fragment and inside a QR code.
const TOKEN_BYTES: usize = 32;

/// Draws `bytes` random bytes and renders them as base64url without padding.
///
/// The error is the operating system's, in English; every caller wraps it in its own Chinese
/// sentence so the user is told which secret could not be produced.
pub fn random_base64url(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0_u8; bytes];
    getrandom::fill(&mut buffer).map_err(|error| error.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(&buffer))
}

/// Generates a fresh access token.
pub fn generate_token() -> Result<String, String> {
    random_base64url(TOKEN_BYTES).map_err(|error| format!("无法生成访问令牌：{error}"))
}

/// Compares two tokens without leaking how far they matched through timing.
pub fn tokens_match(expected: &str, provided: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    expected.as_bytes().ct_eq(provided.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_url_safe_and_unique() {
        let first = generate_token().expect("a token should be generated");
        let second = generate_token().expect("a token should be generated");

        assert_ne!(first, second);
        assert!(!first.contains('=') && !first.contains('+') && !first.contains('/'));
        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(&first)
                .expect("the token should decode")
                .len(),
            TOKEN_BYTES
        );
    }

    #[test]
    fn random_values_have_the_requested_length() {
        let value = random_base64url(16).expect("random bytes should be available");

        assert_eq!(
            URL_SAFE_NO_PAD
                .decode(&value)
                .expect("the value should decode")
                .len(),
            16
        );
    }

    #[test]
    fn token_comparison_rejects_prefixes_and_empty_expectations() {
        assert!(tokens_match("abcdef", "abcdef"));
        assert!(!tokens_match("abcdef", "abcde"));
        assert!(!tokens_match("abcdef", "abcdefg"));
        assert!(!tokens_match("", ""));
    }
}
