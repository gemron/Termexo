//! Enrollment codes: the short one-time strings an administrator hands to whoever is setting up a
//! device. The code exists in one response and in the administrator's clipboard; the database only
//! ever sees its SHA-256.

use termexo_relay_protocol::credential::hash_secret;

use super::random::random_unambiguous;

/// `XXXX-XXXX-XXXX`: three groups of four, which is short enough to read aloud and long enough at
/// 60 bits that guessing one is hopeless even before the per-address lockout.
const GROUP_LENGTH: usize = 4;
const GROUP_COUNT: usize = 3;
const GROUP_SEPARATOR: char = '-';

/// How long a freshly issued code stays redeemable when the console does not say.
pub const DEFAULT_TTL_MINUTES: u32 = 15;
/// A code is meant to be used within minutes of being issued; a day is the outer bound.
pub const MAX_TTL_MINUTES: u32 = 24 * 60;

/// Generates a code in its canonical, grouped spelling.
pub fn generate_code() -> Result<String, String> {
    let characters = random_unambiguous(GROUP_LENGTH * GROUP_COUNT)
        .map_err(|error| format!("无法生成接入码：{error}"))?;
    Ok(group(&characters))
}

/// Brings a typed code back to the spelling that was hashed.
///
/// People paste codes with the dashes, without them, in lower case, or with a stray space from a
/// chat client; all of those mean the same code, and only a wrong *character* should fail.
pub fn normalize_code(code: &str) -> Option<String> {
    let characters: String = code
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .map(|character| character.to_ascii_uppercase())
        .collect();
    (characters.len() == GROUP_LENGTH * GROUP_COUNT).then(|| group(&characters))
}

/// The digest stored in `enrollment_codes.code_hash`, taken over the canonical spelling.
pub fn hash_code(canonical_code: &str) -> String {
    hash_secret(canonical_code)
}

/// Clamps a requested lifetime into the allowed range.
pub fn clamp_ttl_minutes(requested: Option<u32>) -> u32 {
    requested
        .unwrap_or(DEFAULT_TTL_MINUTES)
        .clamp(1, MAX_TTL_MINUTES)
}

fn group(characters: &str) -> String {
    characters
        .as_bytes()
        .chunks(GROUP_LENGTH)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect::<Vec<_>>()
        .join(&GROUP_SEPARATOR.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_generated_code_is_grouped_and_unique() {
        let first = generate_code().expect("a code should be generated");
        let second = generate_code().expect("a code should be generated");

        assert_eq!(first.len(), GROUP_LENGTH * GROUP_COUNT + GROUP_COUNT - 1);
        assert_eq!(first.split(GROUP_SEPARATOR).count(), GROUP_COUNT);
        assert_ne!(first, second);
        assert_eq!(normalize_code(&first).as_deref(), Some(first.as_str()));
    }

    #[test]
    fn a_code_typed_loosely_normalizes_to_the_canonical_spelling() {
        for spelling in [
            "abcd-efgh-jklm",
            "ABCDEFGHJKLM",
            " abcd efgh jklm ",
            "abcd-EFGH-jklm",
        ] {
            assert_eq!(
                normalize_code(spelling).as_deref(),
                Some("ABCD-EFGH-JKLM"),
                "{spelling} should normalize"
            );
        }
    }

    #[test]
    fn a_code_of_the_wrong_length_does_not_normalize() {
        assert_eq!(normalize_code(""), None);
        assert_eq!(normalize_code("ABCD-EFGH"), None);
        assert_eq!(normalize_code("ABCD-EFGH-JKLMN"), None);
    }

    #[test]
    fn hashing_covers_every_spelling_of_the_same_code() {
        let canonical = normalize_code("abcd-efgh-jklm").expect("it should normalize");
        let loose = normalize_code("ABCDEFGHJKLM").expect("it should normalize");

        assert_eq!(hash_code(&canonical), hash_code(&loose));
        assert_ne!(hash_code(&canonical), hash_code("ABCD-EFGH-JKLN"));
        // The digest must not be the code itself, or storing it would be pointless.
        assert!(!hash_code(&canonical).contains("ABCD"));
    }

    #[test]
    fn a_requested_lifetime_is_clamped_into_the_allowed_range() {
        assert_eq!(clamp_ttl_minutes(None), DEFAULT_TTL_MINUTES);
        assert_eq!(clamp_ttl_minutes(Some(60)), 60);
        assert_eq!(clamp_ttl_minutes(Some(0)), 1);
        assert_eq!(clamp_ttl_minutes(Some(u32::MAX)), MAX_TTL_MINUTES);
    }
}
