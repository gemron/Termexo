import { RemoteSealedEnvelope } from '../models/remote-access.models';

/**
 * The browser half of the sealed (v2) `/ws` session.
 *
 * It mirrors `src-tauri/src/remote/session_crypto.rs` byte for byte: the same HKDF labels, the same
 * salt, the same nonce layout. Both suites are pinned to one shared vector, which is what proves
 * the two implementations interoperate without either of them starting a process.
 */

/** The protocol this client speaks; a server offering less is answered with the v1 handshake. */
export const SESSION_PROTOCOL_VERSION = 2;

const NONCE_BYTES = 32;
const KEY_BITS = 256;
const FRAME_NONCE_BYTES = 12;
const COUNTER_BYTES = 8;
const HASH = 'SHA-256';

/** HKDF labels. The two frame labels are what gives each direction a key of its own. */
const AUTH_INFO = 'termexo-auth';
const CLIENT_TO_SERVER_INFO = 'termexo-c2s';
const SERVER_TO_CLIENT_INFO = 'termexo-s2c';

const SEALED_FRAME_TYPE = 'sealed';

const HANDSHAKE_NONCE_ERROR = '服务端的握手随机数格式不正确。';
const REPLAYED_COUNTER_ERROR = '封装帧的计数器没有递增。';
const FORGED_FRAME_ERROR = '封装帧无法解密。';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** What one completed handshake hands back: the `auth` frame's two fields, and the session. */
export interface SessionHandshake {
  /** This browser's half of the nonce, base64url. */
  nonceC: string;
  /** Proof that this browser holds the token, which itself never leaves the browser. */
  proof: string;
  session: SealedSession;
}

/**
 * Whether this page can seal a session at all.
 *
 * `crypto.subtle` exists only in a secure context, so a workbench opened over plain http on the
 * local network has to fall back to the v1 handshake — and the server only accepts that there.
 */
export function webCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle?.importKey === 'function';
}

/**
 * Answers the server's challenge: derives the three keys, signs the proof and keeps both frame
 * keys ready.
 *
 * The keys are imported once here rather than per frame, because terminal output arrives as a
 * high-frequency stream and a key import per frame would cost more than the decryption itself.
 */
export async function negotiateSession(
  token: string,
  encodedServerNonce: string,
): Promise<SessionHandshake> {
  const serverNonce = decodeBase64Url(encodedServerNonce);
  if (serverNonce.length !== NONCE_BYTES) {
    throw new Error(HANDSHAKE_NONCE_ERROR);
  }
  const clientNonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const salt = concatenate(serverNonce, clientNonce);

  const material = await crypto.subtle.importKey('raw', TEXT_ENCODER.encode(token), 'HKDF', false, [
    'deriveBits',
  ]);
  const [authBits, outboundBits, inboundBits] = await Promise.all([
    deriveBits(material, salt, AUTH_INFO),
    deriveBits(material, salt, CLIENT_TO_SERVER_INFO),
    deriveBits(material, salt, SERVER_TO_CLIENT_INFO),
  ]);

  const authKey = await crypto.subtle.importKey(
    'raw',
    authBits,
    { name: 'HMAC', hash: HASH },
    false,
    ['sign'],
  );
  const proof = await crypto.subtle.sign('HMAC', authKey, salt);
  const [outbound, inbound] = await Promise.all([
    importFrameKey(outboundBits),
    importFrameKey(inboundBits),
  ]);

  return {
    nonceC: encodeBase64Url(clientNonce),
    proof: encodeBase64Url(new Uint8Array(proof)),
    session: new SealedSession(outbound, inbound),
  };
}

/**
 * Seals and opens the frames of one connection.
 *
 * Both operations are asynchronous, so both are chained: the counter a frame carries has to be the
 * order it is written, and the frames handed back to the caller have to arrive in the order the
 * server sent them, whatever order the browser happens to finish the cipher work in.
 */
export class SealedSession {
  private sendCounter = 0;
  private expectedCounter = 0;
  private sending: Promise<unknown> = Promise.resolve();
  private receiving: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly outbound: CryptoKey,
    private readonly inbound: CryptoKey,
  ) {}

  /** Seals one frame and returns the envelope text to write. */
  seal(plaintext: string): Promise<string> {
    const sealed = this.sending.then(() => this.sealNext(plaintext));
    // The chain itself must not stay rejected, or one failure would block every later frame.
    this.sending = sealed.catch(() => undefined);
    return sealed;
  }

  /** Opens one envelope and returns the frame text inside it. */
  open(envelope: RemoteSealedEnvelope): Promise<string> {
    const opened = this.receiving.then(() => this.openNext(envelope));
    this.receiving = opened.catch(() => undefined);
    return opened;
  }

  private async sealNext(plaintext: string): Promise<string> {
    const n = this.sendCounter;
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: frameNonce(n) },
      this.outbound,
      TEXT_ENCODER.encode(plaintext),
    );
    this.sendCounter = n + 1;
    const envelope: RemoteSealedEnvelope & { type: string } = {
      type: SEALED_FRAME_TYPE,
      n,
      c: encodeBase64Url(new Uint8Array(ciphertext)),
    };
    return JSON.stringify(envelope);
  }

  private async openNext(envelope: RemoteSealedEnvelope): Promise<string> {
    if (!Number.isSafeInteger(envelope.n) || envelope.n < this.expectedCounter) {
      throw new Error(REPLAYED_COUNTER_ERROR);
    }
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: frameNonce(envelope.n) },
        this.inbound,
        decodeBase64Url(envelope.c),
      );
    } catch {
      // Either the payload was not base64url or the tag did not verify; both mean the frame was
      // not written by the desktop holding this key.
      throw new Error(FORGED_FRAME_ERROR);
    }
    this.expectedCounter = envelope.n + 1;
    return TEXT_DECODER.decode(plaintext);
  }
}

function deriveBits(
  material: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  info: string,
): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    { name: 'HKDF', hash: HASH, salt, info: TEXT_ENCODER.encode(info) },
    material,
    KEY_BITS,
  );
}

function importFrameKey(bits: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Four zero bytes then the big-endian counter; the direction is already carried by the key. */
function frameNonce(counter: number): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(FRAME_NONCE_BYTES);
  new DataView(nonce.buffer).setBigUint64(FRAME_NONCE_BYTES - COUNTER_BYTES, BigInt(counter));
  return nonce;
}

function concatenate(first: Uint8Array, second: Uint8Array): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws on anything that is not base64url, which every caller treats as a rejected frame. */
export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(standard.padEnd(standard.length + ((4 - (standard.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
