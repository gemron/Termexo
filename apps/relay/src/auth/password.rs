//! Console account passwords: argon2id hashing and the generated passwords the relay prints.

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

use super::random::random_unambiguous;

/// Length of a generated password. 16 characters out of a 32-symbol alphabet is 80 bits, well past
/// what a hashed, rate-limited login endpoint needs.
const GENERATED_PASSWORD_LENGTH: usize = 16;

/// Shortest password the console accepts. A relay is reachable from the internet, so the floor is
/// higher than a local-only service would need.
pub const MIN_PASSWORD_LENGTH: usize = 12;

/// Produces an argon2id hash with a fresh random salt, in the PHC string format the column stores.
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| hash_failure(&error))
}

/// Whether a password matches a stored hash.
///
/// A hash the relay cannot parse is treated as "no match" rather than an error: the only way to get
/// one is a hand-edited row, and letting that fail open would be far worse than a refused login.
pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        tracing::warn!("数据库中的密码散列无法解析，已按不匹配处理");
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// A password for an account the relay creates on the operator's behalf.
pub fn generate_password() -> Result<String, String> {
    random_unambiguous(GENERATED_PASSWORD_LENGTH).map_err(|error| format!("无法生成密码：{error}"))
}

fn hash_failure(error: &impl std::fmt::Display) -> String {
    format!("无法处理密码：{error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_password_verifies_against_its_own_hash_only() {
        let hash = hash_password("correct horse battery").expect("hashing should work");

        assert!(verify_password("correct horse battery", &hash));
        assert!(!verify_password("correct horse batter", &hash));
        assert!(!verify_password("", &hash));
    }

    #[test]
    fn the_same_password_hashes_differently_every_time() {
        let first = hash_password("correct horse battery").expect("hashing should work");
        let second = hash_password("correct horse battery").expect("hashing should work");

        assert_ne!(first, second, "each hash must carry its own salt");
        assert!(first.starts_with("$argon2id$"));
    }

    #[test]
    fn an_unparsable_hash_never_matches() {
        assert!(!verify_password("anything", "not-a-phc-string"));
        assert!(!verify_password("anything", ""));
    }

    #[test]
    fn generated_passwords_are_long_enough_for_the_console_floor() {
        let password = generate_password().expect("a password should be generated");

        assert_eq!(password.chars().count(), GENERATED_PASSWORD_LENGTH);
        assert!(password.chars().count() >= MIN_PASSWORD_LENGTH);
    }
}
