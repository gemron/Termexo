//! Human-readable random strings for the secrets a person has to retype: the bootstrap password and
//! the enrollment code.

/// Base32-style alphabet with `0`, `O`, `1` and `I` removed, so a code read off a screen and typed
/// into another machine cannot be mistyped into a different valid code.
///
/// Exactly 32 characters, which also makes `byte % 32` a uniform draw: 256 is a multiple of 32, so
/// no value of a random byte is more likely than another and no rejection sampling is needed.
pub const UNAMBIGUOUS_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/// Draws `count` characters from [`UNAMBIGUOUS_ALPHABET`].
pub fn random_unambiguous(count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; count];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes
        .into_iter()
        .map(|byte| UNAMBIGUOUS_ALPHABET[usize::from(byte) % UNAMBIGUOUS_ALPHABET.len()] as char)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_alphabet_is_uniformly_drawable_and_free_of_look_alikes() {
        assert_eq!(UNAMBIGUOUS_ALPHABET.len(), 32);
        assert_eq!(256 % UNAMBIGUOUS_ALPHABET.len(), 0);
        for confusable in *b"0O1I" {
            assert!(!UNAMBIGUOUS_ALPHABET.contains(&confusable));
        }
    }

    #[test]
    fn generated_values_have_the_requested_length_and_differ() {
        let first = random_unambiguous(16).expect("random bytes should be available");
        let second = random_unambiguous(16).expect("random bytes should be available");

        assert_eq!(first.chars().count(), 16);
        assert_ne!(first, second);
        assert!(first
            .bytes()
            .all(|byte| UNAMBIGUOUS_ALPHABET.contains(&byte)));
    }
}
