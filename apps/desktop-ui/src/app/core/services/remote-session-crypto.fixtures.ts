import { decodeBase64Url, SealedSession } from './remote-session-crypto';

/**
 * The pinned cross-language vector for the sealed `/ws` session, and the desktop's side of it.
 *
 * Test material only — no application code imports this file. The Rust suite in
 * `src-tauri/src/remote/session_crypto.rs` carries the identical constants, so a change on either
 * side that would break interoperation fails a test instead of a connection.
 *
 * The key derivation below is written out rather than taken from `remote-session-crypto.ts`, so it
 * is a second implementation of the same specification; `remote-session-crypto.spec.ts` checks it
 * against the pinned ciphertext to keep the two from drifting apart quietly.
 */
export const SESSION_VECTOR = {
  token: 'F9vGqHkLpS2tU4wX6yZ8aB0cD1eF3gH5jK7mN9pQrSu',
  /** Bytes 0x00..=0x1F. */
  nonceS: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  /** Bytes 0x20..=0x3F. */
  nonceC: 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8',
  plaintext: '{"type":"ping"}',
  proof: 'dFM1jDdQcRHscS8WwJ3P-ncd8jdpzPtCs4GpxNM1rKI',
  /** The plaintext sealed under the client-to-server key at counter 0. */
  clientToServer: 'UQEEpOuCo0XUz1y617L3N-3Q01uBy2HMrGEr1cEhRQ',
  /** The plaintext sealed under the server-to-client key at counter 0. */
  serverToClient: 'Bz8xKVIwCiyNZrrdN_gQ0Xbhjxjvlew2KwBzNBHYdA',
} as const;

const CLIENT_TO_SERVER_INFO = 'termexo-c2s';
const SERVER_TO_CLIENT_INFO = 'termexo-s2c';

/** Builds the desktop's half of the pinned session, so a suite can answer a browser handshake. */
export async function desktopSession(): Promise<SealedSession> {
  const [outbound, inbound] = await Promise.all([
    vectorFrameKey(SERVER_TO_CLIENT_INFO),
    vectorFrameKey(CLIENT_TO_SERVER_INFO),
  ]);
  return new SealedSession(outbound, inbound);
}

/** Replaces the random client nonce with the vector's, so a handshake becomes reproducible. */
export function pinnedClientNonce(target: Uint8Array): Uint8Array {
  target.set(decodeBase64Url(SESSION_VECTOR.nonceC));
  return target;
}

async function vectorFrameKey(info: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const serverNonce = decodeBase64Url(SESSION_VECTOR.nonceS);
  const clientNonce = decodeBase64Url(SESSION_VECTOR.nonceC);
  const salt = new Uint8Array(serverNonce.length + clientNonce.length);
  salt.set(serverNonce);
  salt.set(clientNonce, serverNonce.length);

  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SESSION_VECTOR.token),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(info) },
    material,
    256,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
