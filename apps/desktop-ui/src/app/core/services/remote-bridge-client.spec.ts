import { RemoteBridgeClient, RemoteSocket } from './remote-bridge-client';

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
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  drop(): void {
    this.onclose?.();
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  }
}

describe('RemoteBridgeClient', () => {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  let client: RemoteBridgeClient;

  function newestSocket(): FakeSocket {
    return sockets[sockets.length - 1];
  }

  beforeEach(() => {
    sockets.length = 0;
    urls.length = 0;
    client = new RemoteBridgeClient((url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
  });

  afterEach(() => {
    client.forget();
    vi.useRealTimers();
  });

  it('derives the bridge URL from the page it was served from', () => {
    client.setToken('secret');

    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^wss?:\/\/.+\/ws$/);
    expect(client.state).toBe('connecting');
  });

  it('authenticates first and only then sends the calls it queued', async () => {
    client.setToken('secret');
    const pending = client.invoke<number[]>('list_workspaces');

    newestSocket().open();
    expect(client.state).toBe('authenticating');
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

  it('passes a command error through unchanged', async () => {
    client.setToken('secret');
    newestSocket().open();
    newestSocket().receive({ type: 'ready', serverVersion: '0.7.0' });
    const pending = client.invoke('save_workspace');

    newestSocket().receive({ type: 'result', id: 1, ok: false, error: '保存失败' });

    await expect(pending).rejects.toBe('保存失败');
  });

  it('rejects the queue and stops retrying once the token is refused', async () => {
    client.setToken('wrong');
    const pending = client.invoke('list_workspaces');
    newestSocket().open();

    newestSocket().receive({ type: 'auth-failed', reason: '令牌无效' });

    await expect(pending).rejects.toThrow('未授权');
    expect(client.state).toBe('unauthorized');
    expect(client.error).toBe('令牌无效');
    await expect(client.invoke('list_workspaces')).rejects.toThrow('未授权');
  });

  it('rejects in-flight calls when the connection drops', async () => {
    client.setToken('secret');
    newestSocket().open();
    newestSocket().receive({ type: 'ready', serverVersion: '0.7.0' });
    const pending = client.invoke('list_workspaces');

    newestSocket().drop();

    await expect(pending).rejects.toThrow('连接已断开');
    expect(client.state).toBe('reconnecting');
  });

  it('backs off between reconnection attempts', () => {
    vi.useFakeTimers();
    client.setToken('secret');
    newestSocket().open();
    newestSocket().receive({ type: 'ready', serverVersion: '0.7.0' });

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
    newestSocket().open();
    newestSocket().receive({ type: 'ready', serverVersion: '0.7.0' });

    vi.advanceTimersByTime(45_000);
    expect(sockets[0].closed).toBe(true);
    vi.advanceTimersByTime(1_000);

    expect(sockets).toHaveLength(2);
  });

  it('delivers events in the shape the Tauri listener uses', () => {
    const received: unknown[] = [];
    client.setToken('secret');
    newestSocket().open();
    newestSocket().receive({ type: 'ready', serverVersion: '0.7.0' });
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
    newestSocket().open();
    newestSocket().receive({ type: 'ready', serverVersion: '0.7.0' });
    client.listen('resync', () => (resyncs += 1));

    newestSocket().receive({ type: 'resync' });

    expect(resyncs).toBe(1);
  });

  it('announces a restored connection but not the first one', () => {
    vi.useFakeTimers();
    let reconnections = 0;
    client.onReconnected(() => (reconnections += 1));

    client.setToken('secret');
    newestSocket().open();
    newestSocket().receive({ type: 'ready', serverVersion: '0.7.0' });
    expect(reconnections).toBe(0);

    newestSocket().drop();
    vi.advanceTimersByTime(1_000);
    newestSocket().open();
    newestSocket().receive({ type: 'ready', serverVersion: '0.7.0' });

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
