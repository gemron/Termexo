import {
  desktopSession,
  pinnedClientNonce,
  SESSION_VECTOR,
} from './remote-session-crypto.fixtures';
import { negotiateSession, SealedSession, webCryptoAvailable } from './remote-session-crypto';

/** The envelope a sealed frame is written as, which is what `seal` returns as text. */
function envelopeOf(text: string): { type: string; n: number; c: string } {
  return JSON.parse(text) as { type: string; n: number; c: string };
}

describe('remote session crypto', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports whether this page can seal a session at all', () => {
    expect(webCryptoAvailable()).toBe(true);
  });

  /**
   * The one test that proves the browser and the desktop agree on the wire. Every constant here
   * also appears in `src-tauri/src/remote/session_crypto.rs`, so neither side can change the
   * derivation, the salt or the nonce layout without the other failing.
   */
  it('matches the pinned cross-language vector in both directions', async () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(
      (target) => pinnedClientNonce(target as Uint8Array) as typeof target,
    );

    const handshake = await negotiateSession(SESSION_VECTOR.token, SESSION_VECTOR.nonceS);

    expect(handshake.nonceC).toBe(SESSION_VECTOR.nonceC);
    expect(handshake.proof).toBe(SESSION_VECTOR.proof);

    const sealed = envelopeOf(await handshake.session.seal(SESSION_VECTOR.plaintext));
    expect(sealed).toEqual({ type: 'sealed', n: 0, c: SESSION_VECTOR.clientToServer });

    // And the frame the desktop sealed under the other key opens back to the same plaintext.
    await expect(handshake.session.open({ n: 0, c: SESSION_VECTOR.serverToClient })).resolves.toBe(
      SESSION_VECTOR.plaintext,
    );
  });

  /** Keeps the suite's own desktop-side derivation from drifting away from the specification. */
  it('builds a desktop session that produces the pinned server ciphertext', async () => {
    const desktop = await desktopSession();

    const sealed = envelopeOf(await desktop.seal(SESSION_VECTOR.plaintext));

    expect(sealed.c).toBe(SESSION_VECTOR.serverToClient);
  });

  it('carries a conversation both ways and counts every frame', async () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(
      (target) => pinnedClientNonce(target as Uint8Array) as typeof target,
    );
    const { session } = await negotiateSession(SESSION_VECTOR.token, SESSION_VECTOR.nonceS);
    const desktop = await desktopSession();

    for (const [index, plaintext] of ['{"type":"ping"}', '{"type":"pong"}', ''].entries()) {
      const sealed = envelopeOf(await session.seal(plaintext));
      expect(sealed.n).toBe(index);
      await expect(desktop.open(sealed)).resolves.toBe(plaintext);

      const answered = envelopeOf(await desktop.seal(plaintext));
      expect(answered.n).toBe(index);
      await expect(session.open(answered)).resolves.toBe(plaintext);
    }
  });

  it('refuses a repeated or lower counter', async () => {
    const desktop = await desktopSession();
    const browser = await browserSession();
    const first = envelopeOf(await desktop.seal('{"type":"ping"}'));
    const second = envelopeOf(await desktop.seal('{"type":"pong"}'));

    await expect(browser.open(second)).resolves.toBe('{"type":"pong"}');
    await expect(browser.open(second)).rejects.toThrow('计数器');
    await expect(browser.open(first)).rejects.toThrow('计数器');
  });

  it('refuses a payload that was tampered with or is not base64url', async () => {
    const desktop = await desktopSession();
    const browser = await browserSession();
    const sealed = envelopeOf(await desktop.seal('{"type":"ping"}'));

    // The leading character is flipped rather than the trailing one: base64url's last character
    // carries spare bits that a decoder ignores, so changing it need not change a single byte.
    const tampered = `${sealed.c.startsWith('A') ? 'B' : 'A'}${sealed.c.slice(1)}`;
    await expect(browser.open({ n: sealed.n, c: tampered })).rejects.toThrow('无法解密');
    await expect(browser.open({ n: 0, c: 'not base64url!' })).rejects.toThrow('无法解密');
  });

  /**
   * Decryption is asynchronous, so two frames could finish out of order. The session serializes
   * them: the second never even starts before the first has resolved, and the plaintexts reach the
   * caller in counter order however long an individual decryption takes.
   */
  it('delivers frames in counter order even when the cipher finishes out of order', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(32),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
    const session = new SealedSession(key, key);
    const started: number[] = [];
    const finished: number[] = [];
    // The first frame takes the longest, so a concurrent implementation would deliver it last.
    const delays = [30, 10, 0];
    vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (_algorithm, _key, data) => {
      const index = (data as Uint8Array)[0];
      started.push(index);
      await new Promise((resolve) => setTimeout(resolve, delays[index]));
      finished.push(index);
      return new TextEncoder().encode(`{"type":"event","name":"frame-${index}","payload":null}`)
        .buffer as ArrayBuffer;
    });

    const delivered = await Promise.all(
      delays.map((_delay, index) => session.open({ n: index, c: counterPayload(index) })),
    );

    expect(delivered.map((frame) => JSON.parse(frame).name)).toEqual([
      'frame-0',
      'frame-1',
      'frame-2',
    ]);
    expect(started).toEqual([0, 1, 2]);
    // Serialized rather than concurrent: each decryption finished before the next one began.
    expect(finished).toEqual([0, 1, 2]);
  });
});

/** The browser's half of the pinned session, without going through a handshake. */
async function browserSession(): Promise<SealedSession> {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(
    (target) => pinnedClientNonce(target as Uint8Array) as typeof target,
  );
  const { session } = await negotiateSession(SESSION_VECTOR.token, SESSION_VECTOR.nonceS);
  vi.mocked(crypto.getRandomValues).mockRestore();
  return session;
}

/** A payload whose first byte is the frame index, which is all the stubbed cipher reads. */
function counterPayload(index: number): string {
  return btoa(String.fromCharCode(index))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
