import { RemoteSealedEnvelope } from '../models/remote-access.models';
import { RemoteBridgeClient, RemoteSocket } from './remote-bridge-client';
import { SealedSession } from './remote-session-crypto';
import {
  desktopSession,
  pinnedClientNonce,
  SESSION_VECTOR,
} from './remote-session-crypto.fixtures';

/** A socket that never leaves the test process, so no suite can dial a real server. */
class FakeSocket implements RemoteSocket {
  readonly sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  receive(frame: unknown): void {
    this.receiveText(JSON.stringify(frame));
  }

  receiveText(text: string): void {
    this.onmessage?.({ data: text });
  }

  drop(): void {
    this.onclose?.();
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  }
}

/** Waits for work the session crypto scheduled; a handshake takes several event-loop turns. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('RemoteBridgeClient', () => {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  let client: RemoteBridgeClient;

  function newestSocket(): FakeSocket {
    return sockets[sockets.length - 1];
  }

  /**
   * Runs the older handshake, which a server offering protocol 1 asks for.
   *
   * Most of this suite is about queueing, reconnection and event delivery rather than about the
   * envelope, and that handshake completes without a single asynchronous step.
   */
  function handshakeV1(serverVersion = '0.7.0'): FakeSocket {
    const socket = newestSocket();
    socket.open();
    socket.receive({ type: 'challenge', protocol: 1, nonceS: '' });
    socket.receive({ type: 'ready', serverVersion });
    return socket;
  }

  /** Lets one test play a plain-http page, the only place the older handshake still applies. */
  let canSeal = true;

  beforeEach(() => {
    canSeal = true;
    sockets.length = 0;
    urls.length = 0;
    client = new RemoteBridgeClient(
      (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      () => canSeal,
    );
  });

  afterEach(() => {
    client.forget();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('derives the bridge URL from the page it was served from', () => {
    client.setToken('secret');

    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(`ws://${window.location.host}/ws`);
    expect(client.state).toBe('connecting');
  });

  it('keeps the bridge beside the page when a relay serves it from a sub-path', () => {
    const base = document.createElement('base');
    base.setAttribute('href', '/d/abc/');
    document.head.appendChild(base);
    try {
      client.setToken('secret');

      expect(urls[0]).toBe(`ws://${window.location.host}/d/abc/ws`);
    } finally {
      base.remove();
    }
  });

  it('says nothing until the server has offered its challenge', () => {
    client.setToken('secret');

    newestSocket().open();

    expect(client.state).toBe('authenticating');
    expect(newestSocket().frames()).toHaveLength(0);
  });

  it('authenticates first and only then sends the calls it queued', async () => {
    client.setToken('secret');
    const pending = client.invoke<number[]>('list_workspaces');

    newestSocket().open();
    newestSocket().receive({ type: 'challenge', protocol: 1, nonceS: '' });
    expect(newestSocket().frames()[0]).toEqual(
      expect.objectContaining({ type: 'auth', token: 'secret' }),
    );
    // The call waits for the handshake rather than racing it.
    expect(newestSocket().frames()).toHaveLength(1);

    newestSocket().receive({ type: 'ready', serverVersion: '0.7.0' });
    expect(client.state).toBe('ready');
    const invokeFrame = newestSocket().frames()[1];
    expect(invokeFrame).toEqual(
      expect.objectContaining({ type: 'invoke', command: 'list_workspaces' }),
    );

    newestSocket().receive({ type: 'result', id: invokeFrame['id'], ok: true, value: [1, 2] });

    await expect(pending).resolves.toEqual([1, 2]);
  });

  it('proves it holds the token and carries calls inside the envelope', async () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(
      (target) => pinnedClientNonce(target as Uint8Array) as typeof target,
    );
    const desktop = await desktopSession();
    client.setToken(SESSION_VECTOR.token);
    const socket = newestSocket();

    socket.open();
    socket.receive({ type: 'challenge', protocol: 2, nonceS: SESSION_VECTOR.nonceS });
    await waitFor(() => socket.frames().length > 0, 'the auth frame');

    // The token itself is not in the frame; only a proof derived from it and both nonces.
    expect(socket.frames()[0]).toEqual({
      type: 'auth',
      protocol: 2,
      clientId: expect.any(String),
      nonceC: SESSION_VECTOR.nonceC,
      proof: SESSION_VECTOR.proof,
    });
    expect(socket.sent[0]).not.toContain(SESSION_VECTOR.token);

    await sealTo(socket, desktop, { type: 'ready', serverVersion: '0.9.0' });
    await waitFor(() => client.state === 'ready', 'the sealed ready frame');

    const pending = client.invoke<number[]>('list_workspaces');
    await waitFor(() => socket.frames().length > 1, 'the sealed call');
    const envelope = socket.frames()[1];
    expect(envelope['type']).toBe('sealed');
    const call = JSON.parse(await desktop.open(envelope as unknown as RemoteSealedEnvelope)) as {
      id: number;
      command: string;
    };
    expect(call).toEqual({ type: 'invoke', id: 1, command: 'list_workspaces' });

    await sealTo(socket, desktop, { type: 'result', id: call.id, ok: true, value: [1, 2] });

    await expect(pending).resolves.toEqual([1, 2]);
  });

  it('drops a sealed connection that starts sending frames in the clear', async () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(
      (target) => pinnedClientNonce(target as Uint8Array) as typeof target,
    );
    const desktop = await desktopSession();
    client.setToken(SESSION_VECTOR.token);
    const socket = newestSocket();
    socket.open();
    socket.receive({ type: 'challenge', protocol: 2, nonceS: SESSION_VECTOR.nonceS });
    await waitFor(() => socket.frames().length > 0, 'the auth frame');
    await sealTo(socket, desktop, { type: 'ready', serverVersion: '0.9.0' });
    await waitFor(() => client.state === 'ready', 'the sealed ready frame');

    socket.receive({ type: 'event', name: 'terminal-output', payload: {} });

    expect(socket.closed).toBe(true);
    expect(client.state).toBe('reconnecting');
    expect(client.error).toContain('未加密');
  });

  /**
   * A page opened over plain http has no `crypto.subtle`, so it can only offer the older
   * handshake. The server accepts that on the local network and refuses it anywhere a relay or
   * https is involved, and its refusal is what tells the user to switch to HTTPS.
   */
  it('falls back to the older handshake without WebCrypto and surfaces the refusal', async () => {
    canSeal = false;
    client.setToken('secret');
    newestSocket().open();

    newestSocket().receive({ type: 'challenge', protocol: 2, nonceS: SESSION_VECTOR.nonceS });

    expect(newestSocket().frames()[0]).toEqual(
      expect.objectContaining({ type: 'auth', token: 'secret' }),
    );

    newestSocket().receive({
      type: 'auth-failed',
      reason: '此连接要求加密握手，请改用 HTTPS 打开远程工作台。',
    });

    expect(client.state).toBe('unauthorized');
    expect(client.error).toBe('此连接要求加密握手，请改用 HTTPS 打开远程工作台。');
  });

  it('passes a command error through unchanged', async () => {
    client.setToken('secret');
    handshakeV1();
    const pending = client.invoke('save_workspace');

    newestSocket().receive({ type: 'result', id: 1, ok: false, error: '保存失败' });

    await expect(pending).rejects.toBe('保存失败');
  });

  it('rejects the queue and stops retrying once the token is refused', async () => {
    client.setToken('wrong');
    const pending = client.invoke('list_workspaces');
    newestSocket().open();
    newestSocket().receive({ type: 'challenge', protocol: 1, nonceS: '' });

    newestSocket().receive({ type: 'auth-failed', reason: '令牌无效' });

    await expect(pending).rejects.toThrow('未授权');
    expect(client.state).toBe('unauthorized');
    expect(client.error).toBe('令牌无效');
    await expect(client.invoke('list_workspaces')).rejects.toThrow('未授权');
  });

  it('rejects in-flight calls when the connection drops', async () => {
    client.setToken('secret');
    handshakeV1();
    const pending = client.invoke('list_workspaces');

    newestSocket().drop();

    await expect(pending).rejects.toThrow('连接已断开');
    expect(client.state).toBe('reconnecting');
  });

  it('backs off between reconnection attempts', () => {
    client.setToken('secret');
    handshakeV1();
    vi.useFakeTimers();

    newestSocket().drop();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    // A second failure without a successful handshake waits twice as long.
    newestSocket().drop();
    vi.advanceTimersByTime(1_999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
  });

  it('reconnects when no frame arrives for too long', () => {
    vi.useFakeTimers();
    client.setToken('secret');
    handshakeV1();

    vi.advanceTimersByTime(45_000);
    expect(sockets[0].closed).toBe(true);
    vi.advanceTimersByTime(1_000);

    expect(sockets).toHaveLength(2);
  });

  it('delivers events in the shape the Tauri listener uses', () => {
    const received: unknown[] = [];
    client.setToken('secret');
    handshakeV1();
    client.listen('terminal-output', (event) => received.push(event));

    newestSocket().receive({
      type: 'event',
      name: 'terminal-output',
      payload: { terminalId: 'terminal-1', data: 'hello' },
    });

    expect(received).toEqual([
      { event: 'terminal-output', payload: { terminalId: 'terminal-1', data: 'hello' } },
    ]);
  });

  it('tells subscribers to replay when the server drops frames', () => {
    let resyncs = 0;
    client.setToken('secret');
    handshakeV1();
    client.listen('resync', () => (resyncs += 1));

    newestSocket().receive({ type: 'resync' });

    expect(resyncs).toBe(1);
  });

  it('announces a restored connection but not the first one', () => {
    let reconnections = 0;
    client.onReconnected(() => (reconnections += 1));

    client.setToken('secret');
    handshakeV1();
    expect(reconnections).toBe(0);
    vi.useFakeTimers();

    newestSocket().drop();
    vi.advanceTimersByTime(1_000);
    handshakeV1();

    expect(reconnections).toBe(1);
  });

  it('rejects everything once the token is forgotten', async () => {
    client.setToken('secret');
    newestSocket().open();

    client.forget();

    expect(sockets[0].closed).toBe(true);
    expect(client.state).toBe('unauthorized');
    await expect(client.invoke('list_workspaces')).rejects.toThrow('未授权');
  });
});

/** Hands the client a frame sealed the way the desktop would have sealed it. */
async function sealTo(socket: FakeSocket, desktop: SealedSession, frame: unknown): Promise<void> {
  socket.receiveText(await desktop.seal(JSON.stringify(frame)));
}
