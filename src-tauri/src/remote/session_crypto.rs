//! The sealed (v2) `/ws` session: key agreement from the access token, and the AES-256-GCM
//! envelope every frame travels in once the handshake succeeded.
//!
//! The browser and the desktop already share one secret nothing on the path knows — the access
//! token — so the handshake turns it into a proof and a pair of frame keys instead of sending it.
//! A relay therefore forwards terminal output and command arguments it cannot read, and the token
//! itself never appears in a frame even on the local network.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use data_encoding::BASE64URL_NOPAD;
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use termexo_relay_protocol::secret::random_base64url;

/// The handshake implemented here. A client that leaves `protocol` out of its `auth` frame is
/// speaking v1, where the token travelled in the clear.
pub const PROTOCOL_VERSION: u8 = 2;

/// Each side contributes this many random bytes to the handshake, and every derived key is the
/// same width.
pub const NONCE_BYTES: usize = 32;
const KEY_BYTES: usize = 32;

/// AES-GCM's nonce: four zero bytes followed by the big-endian frame counter.
const FRAME_NONCE_BYTES: usize = 12;
const COUNTER_BYTES: usize = 8;

/// HKDF labels. They are what separates three independent keys out of one token, and — for the two
/// frame keys — what keeps the directions apart: under a single shared key the client's frame `n`
/// and the server's frame `n` would run on the same (key, nonce) pair, which AES-GCM does not
/// survive. It leaks the exclusive-or of both plaintexts and hands out material to forge tags.
const AUTH_INFO: &[u8] = b"termexo-auth";
const CLIENT_TO_SERVER_INFO: &[u8] = b"termexo-c2s";
const SERVER_TO_CLIENT_INFO: &[u8] = b"termexo-s2c";

/// Which way a frame travels. It picks the key, so a frame can never be replayed back at whoever
/// sent it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    ClientToServer,
    ServerToClient,
}

/// Why a frame could not be accepted. The text is user-facing: it becomes the close reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionError {
    /// A counter that did not move forward, which on an ordered transport means a replay.
    ReplayedCounter,
    /// The payload is not base64url.
    MalformedPayload,
    /// The authentication tag did not verify: the frame was forged or corrupted in transit.
    ForgedFrame,
    /// The cipher refused to seal, which only a fault inside the process can cause.
    SealFailed,
}

impl SessionError {
    pub const fn reason(self) -> &'static str {
        match self {
            Self::ReplayedCounter => "封装帧的计数器没有递增。",
            Self::MalformedPayload => "封装帧的载荷格式不正确。",
            Self::ForgedFrame => "封装帧无法解密。",
            Self::SealFailed => "无法加密返回帧。",
        }
    }
}

/// One side's half of the handshake nonce, kept in both spellings it is needed in: the base64url
/// that goes on the wire, and the bytes that go into the key derivation.
pub struct HandshakeNonce {
    pub bytes: [u8; NONCE_BYTES],
    pub encoded: String,
}

impl HandshakeNonce {
    pub fn generate() -> Result<Self, String> {
        let encoded = random_base64url(NONCE_BYTES)?;
        let bytes = decode_nonce(&encoded).ok_or_else(|| "握手随机数编码异常。".to_string())?;
        Ok(Self { bytes, encoded })
    }
}

/// Decodes a peer's nonce, refusing anything that is not exactly `NONCE_BYTES` of base64url.
pub fn decode_nonce(encoded: &str) -> Option<[u8; NONCE_BYTES]> {
    BASE64URL_NOPAD
        .decode(encoded.as_bytes())
        .ok()?
        .try_into()
        .ok()
}

/// The keys one handshake produced.
///
/// It owns the only copy of the key material and hands out framers rather than bytes, so no caller
/// is ever in a position to log a key.
pub struct SessionSecrets {
    auth: [u8; KEY_BYTES],
    client_to_server: [u8; KEY_BYTES],
    server_to_client: [u8; KEY_BYTES],
}

impl SessionSecrets {
    /// Derives the proof key and both frame keys from the access token and the two nonces.
    pub fn derive(
        token: &str,
        server_nonce: &[u8; NONCE_BYTES],
        client_nonce: &[u8; NONCE_BYTES],
    ) -> Self {
        let salt = handshake_salt(server_nonce, client_nonce);
        Self {
            auth: derive_key(token, &salt, AUTH_INFO),
            client_to_server: derive_key(token, &salt, CLIENT_TO_SERVER_INFO),
            server_to_client: derive_key(token, &salt, SERVER_TO_CLIENT_INFO),
        }
    }

    /// Whether `proof` is the HMAC a holder of the same token would have produced.
    ///
    /// The comparison runs inside `verify_slice`, which is constant time, so a near miss tells an
    /// attacker nothing through timing.
    pub fn proof_matches(
        &self,
        server_nonce: &[u8; NONCE_BYTES],
        client_nonce: &[u8; NONCE_BYTES],
        proof: &[u8],
    ) -> bool {
        // Spelled out because `aead::KeyInit` is also in scope and offers the same constructor.
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.auth)
            .expect("HMAC accepts a key of any length");
        mac.update(&handshake_salt(server_nonce, client_nonce));
        mac.verify_slice(proof).is_ok()
    }

    pub fn sealer(&self, direction: Direction) -> FrameSealer {
        FrameSealer {
            cipher: self.cipher(direction),
            counter: 0,
        }
    }

    pub fn opener(&self, direction: Direction) -> FrameOpener {
        FrameOpener {
            cipher: self.cipher(direction),
            expected: 0,
        }
    }

    fn cipher(&self, direction: Direction) -> Aes256Gcm {
        let key = match direction {
            Direction::ClientToServer => &self.client_to_server,
            Direction::ServerToClient => &self.server_to_client,
        };
        Aes256Gcm::new_from_slice(key).expect("AES-256 takes a 32-byte key")
    }
}

/// The envelope every frame travels in once the session is sealed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SealedFrame {
    /// The sender's frame counter, which also supplies the cipher nonce.
    pub n: u64,
    /// base64url of the AES-256-GCM ciphertext with its tag appended.
    pub c: String,
}

/// Seals outbound frames under one direction's key.
pub struct FrameSealer {
    cipher: Aes256Gcm,
    counter: u64,
}

impl FrameSealer {
    /// Seals one frame.
    ///
    /// Calls have to stay in the order the frames are written, because the counter handed back is
    /// also the ordering the peer verifies. The counter never repeats and never wraps: exhausting
    /// a `u64` at a billion frames a second would take some six hundred years, so there is
    /// deliberately no wraparound handling to get wrong.
    pub fn seal(&mut self, plaintext: &[u8]) -> Result<SealedFrame, SessionError> {
        let counter = self.counter;
        let sealed = self
            .cipher
            .encrypt(Nonce::from_slice(&frame_nonce(counter)), plaintext)
            .map_err(|_| SessionError::SealFailed)?;
        self.counter += 1;
        Ok(SealedFrame {
            n: counter,
            c: BASE64URL_NOPAD.encode(&sealed),
        })
    }
}

/// Opens inbound frames under one direction's key.
pub struct FrameOpener {
    cipher: Aes256Gcm,
    expected: u64,
}

impl FrameOpener {
    /// Opens one frame, refusing any counter that did not move forward.
    ///
    /// WebSocket delivers reliably and in order, so a repeated or lower counter is not a network
    /// artefact but a replay, and the caller ends the connection over it.
    pub fn open(&mut self, frame: &SealedFrame) -> Result<Vec<u8>, SessionError> {
        if frame.n < self.expected {
            return Err(SessionError::ReplayedCounter);
        }
        let ciphertext = BASE64URL_NOPAD
            .decode(frame.c.as_bytes())
            .map_err(|_| SessionError::MalformedPayload)?;
        let plaintext = self
            .cipher
            .decrypt(
                Nonce::from_slice(&frame_nonce(frame.n)),
                ciphertext.as_slice(),
            )
            .map_err(|_| SessionError::ForgedFrame)?;
        self.expected = frame.n.saturating_add(1);
        Ok(plaintext)
    }
}

/// The HKDF salt: the server's nonce followed by the client's.
///
/// Both nonces belong in the salt rather than in the `info` label — that is what a salt is for —
/// which leaves the labels free to name the three keys and nothing else.
fn handshake_salt(
    server_nonce: &[u8; NONCE_BYTES],
    client_nonce: &[u8; NONCE_BYTES],
) -> [u8; NONCE_BYTES * 2] {
    let mut salt = [0_u8; NONCE_BYTES * 2];
    salt[..NONCE_BYTES].copy_from_slice(server_nonce);
    salt[NONCE_BYTES..].copy_from_slice(client_nonce);
    salt
}

fn derive_key(token: &str, salt: &[u8], info: &[u8]) -> [u8; KEY_BYTES] {
    let mut key = [0_u8; KEY_BYTES];
    Hkdf::<Sha256>::new(Some(salt), token.as_bytes())
        .expand(info, &mut key)
        .expect("32 bytes is far below HKDF's output limit");
    key
}

/// The cipher nonce for one frame. The direction is already carried by the key, so the nonce only
/// has to separate the frames within one direction.
fn frame_nonce(counter: u64) -> [u8; FRAME_NONCE_BYTES] {
    let mut nonce = [0_u8; FRAME_NONCE_BYTES];
    nonce[FRAME_NONCE_BYTES - COUNTER_BYTES..].copy_from_slice(&counter.to_be_bytes());
    nonce
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The vector both implementations are pinned to. The browser suite
    /// (`remote-session-crypto.spec.ts`) repeats these very constants: two implementations that
    /// agree on them agree on the wire, without either test having to start a process.
    const VECTOR_TOKEN: &str = "F9vGqHkLpS2tU4wX6yZ8aB0cD1eF3gH5jK7mN9pQrSu";
    /// Bytes 0x00..=0x1F and 0x20..=0x3F, so the nonces are reproducible by hand.
    const VECTOR_NONCE_S: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    const VECTOR_NONCE_C: &str = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
    const VECTOR_PLAINTEXT: &str = "{\"type\":\"ping\"}";
    const VECTOR_PROOF: &str = "dFM1jDdQcRHscS8WwJ3P-ncd8jdpzPtCs4GpxNM1rKI";
    const VECTOR_CLIENT_TO_SERVER: &str = "UQEEpOuCo0XUz1y617L3N-3Q01uBy2HMrGEr1cEhRQ";
    const VECTOR_SERVER_TO_CLIENT: &str = "Bz8xKVIwCiyNZrrdN_gQ0Xbhjxjvlew2KwBzNBHYdA";

    fn nonces() -> ([u8; NONCE_BYTES], [u8; NONCE_BYTES]) {
        (
            decode_nonce(VECTOR_NONCE_S).expect("the server nonce should decode"),
            decode_nonce(VECTOR_NONCE_C).expect("the client nonce should decode"),
        )
    }

    fn vector_secrets() -> SessionSecrets {
        let (server_nonce, client_nonce) = nonces();
        SessionSecrets::derive(VECTOR_TOKEN, &server_nonce, &client_nonce)
    }

    #[test]
    fn a_nonce_is_generated_in_both_spellings_and_only_the_right_width_decodes() {
        let nonce = HandshakeNonce::generate().expect("a nonce should be drawn");

        assert_eq!(decode_nonce(&nonce.encoded), Some(nonce.bytes));
        assert_eq!(decode_nonce("AAEC"), None);
        assert_eq!(decode_nonce("not base64url!"), None);
    }

    /// One key for both directions would put the client's frame `n` and the server's frame `n` on
    /// the same (key, nonce) pair, and AES-GCM does not survive a reused nonce.
    #[test]
    fn each_direction_gets_a_key_of_its_own() {
        let secrets = vector_secrets();

        assert_ne!(secrets.client_to_server, secrets.server_to_client);
        assert_ne!(secrets.auth, secrets.client_to_server);
        assert_ne!(secrets.auth, secrets.server_to_client);
    }

    #[test]
    fn the_keys_change_with_the_token_and_with_either_nonce() {
        let (server_nonce, client_nonce) = nonces();
        let baseline = SessionSecrets::derive(VECTOR_TOKEN, &server_nonce, &client_nonce);

        let other_token = SessionSecrets::derive("another-token", &server_nonce, &client_nonce);
        let other_server = SessionSecrets::derive(VECTOR_TOKEN, &client_nonce, &client_nonce);
        let other_client = SessionSecrets::derive(VECTOR_TOKEN, &server_nonce, &server_nonce);

        assert_ne!(baseline.client_to_server, other_token.client_to_server);
        assert_ne!(baseline.client_to_server, other_server.client_to_server);
        assert_ne!(baseline.client_to_server, other_client.client_to_server);
    }

    #[test]
    fn the_proof_is_accepted_only_for_the_token_and_the_nonces_it_was_made_for() {
        let (server_nonce, client_nonce) = nonces();
        let secrets = vector_secrets();
        let proof = BASE64URL_NOPAD
            .decode(VECTOR_PROOF.as_bytes())
            .expect("the pinned proof should decode");

        assert!(secrets.proof_matches(&server_nonce, &client_nonce, &proof));
        // Swapping the nonces changes the message the proof covers.
        assert!(!secrets.proof_matches(&client_nonce, &server_nonce, &proof));
        assert!(
            !SessionSecrets::derive("wrong-token", &server_nonce, &client_nonce).proof_matches(
                &server_nonce,
                &client_nonce,
                &proof
            )
        );
        assert!(!secrets.proof_matches(&server_nonce, &client_nonce, b""));
    }

    #[test]
    fn a_sealed_frame_opens_back_to_its_plaintext_in_order() {
        let secrets = vector_secrets();
        let mut sealer = secrets.sealer(Direction::ClientToServer);
        let mut opener = secrets.opener(Direction::ClientToServer);

        for (index, plaintext) in ["{\"type\":\"ping\"}", "{\"type\":\"pong\"}", ""]
            .into_iter()
            .enumerate()
        {
            let frame = sealer.seal(plaintext.as_bytes()).expect("sealing succeeds");
            assert_eq!(frame.n, index as u64);
            assert_eq!(
                opener.open(&frame).expect("the frame should open"),
                plaintext.as_bytes()
            );
        }
    }

    /// The keys are directional, so a frame the client sealed is meaningless to a reader that
    /// expects the server's direction — which is exactly what makes reflection useless.
    #[test]
    fn a_frame_does_not_open_under_the_other_direction() {
        let secrets = vector_secrets();
        let frame = secrets
            .sealer(Direction::ClientToServer)
            .seal(VECTOR_PLAINTEXT.as_bytes())
            .expect("sealing succeeds");

        assert_eq!(
            secrets.opener(Direction::ServerToClient).open(&frame),
            Err(SessionError::ForgedFrame)
        );
    }

    #[test]
    fn a_repeated_or_lower_counter_is_refused() {
        let secrets = vector_secrets();
        let mut sealer = secrets.sealer(Direction::ClientToServer);
        let mut opener = secrets.opener(Direction::ClientToServer);
        let first = sealer.seal(b"one").expect("sealing succeeds");
        let second = sealer.seal(b"two").expect("sealing succeeds");

        assert!(opener.open(&second).is_ok());
        assert_eq!(opener.open(&second), Err(SessionError::ReplayedCounter));
        assert_eq!(opener.open(&first), Err(SessionError::ReplayedCounter));
    }

    #[test]
    fn a_tampered_or_unreadable_payload_is_refused() {
        let secrets = vector_secrets();
        let sealed = secrets
            .sealer(Direction::ClientToServer)
            .seal(VECTOR_PLAINTEXT.as_bytes())
            .expect("sealing succeeds");
        let flipped = SealedFrame {
            n: sealed.n,
            c: format!("{}A", &sealed.c[..sealed.c.len() - 1]),
        };

        assert_eq!(
            secrets.opener(Direction::ClientToServer).open(&flipped),
            Err(SessionError::ForgedFrame)
        );
        assert_eq!(
            secrets
                .opener(Direction::ClientToServer)
                .open(&SealedFrame {
                    n: 0,
                    c: "not base64url!".into(),
                }),
            Err(SessionError::MalformedPayload)
        );
    }

    /// Pins the exact bytes on the wire so the browser implementation can be checked against the
    /// same constants. Changing any of these values is a protocol change, not a refactor.
    #[test]
    fn the_wire_format_matches_the_pinned_cross_language_vector() {
        let secrets = vector_secrets();

        let to_server = secrets
            .sealer(Direction::ClientToServer)
            .seal(VECTOR_PLAINTEXT.as_bytes())
            .expect("sealing succeeds");
        let to_client = secrets
            .sealer(Direction::ServerToClient)
            .seal(VECTOR_PLAINTEXT.as_bytes())
            .expect("sealing succeeds");

        assert_eq!(to_server.n, 0);
        assert_eq!(to_server.c, VECTOR_CLIENT_TO_SERVER);
        assert_eq!(to_client.c, VECTOR_SERVER_TO_CLIENT);
    }

    #[test]
    fn the_frame_nonce_is_the_counter_in_the_trailing_eight_bytes() {
        assert_eq!(frame_nonce(0), [0; FRAME_NONCE_BYTES]);
        assert_eq!(
            frame_nonce(1),
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            "the counter is big-endian and right-aligned"
        );
        assert_eq!(
            frame_nonce(u64::MAX),
            [0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255]
        );
    }
}
