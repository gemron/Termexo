import { RemoteConnectionState, RemoteServerFrame } from '../models/remote-access.models';
import type { BackendEvent, UnlistenFn } from './backend-bridge';
import { resolveRemoteToken } from './remote-token';
import { runtimeClientId } from './tauri-runtime';

/** The slice of `WebSocket` this client uses, so tests can supply a socket that never dials out. */
export interface RemoteSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export type RemoteSocketFactory = (url: string) => RemoteSocket;

/** Backoff between reconnection attempts, holding at the last entry. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const PING_INTERVAL_MS = 20_000;
/** No frame at all for this long means the socket is dead even though it never reported a close. */
const IDLE_TIMEOUT_MS = 45_000;
const BRIDGE_PATH = '/ws';

const UNAUTHORIZED_ERROR = '未授权';
const DISCONNECTED_ERROR = '连接已断开';

/** The event the client raises when the server reports that outbound frames were dropped. */
export const RESYNC_EVENT = 'resync';

interface PendingRequest {
  resolve: (value: never) => void;
  reject: (reason: unknown) => void;
}

interface QueuedRequest extends PendingRequest {
  command: string;
  args?: Record<string, unknown>;
}

type EventHandler = (event: BackendEvent<never>) => void;
type StateHandler = (state: RemoteConnectionState, error: string | null) => void;

function defaultSocketFactory(url: string): RemoteSocket {
  // The browser WebSocket carries richer event objects than this client reads; only `data` matters.
  return new WebSocket(url) as unknown as RemoteSocket;
}

/** Derives the bridge URL from the page the remote workbench was served from. */
function bridgeUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${BRIDGE_PATH}`;
}

/**
 * Carries `invoke` calls and backend events over the remote-access WebSocket.
 *
 * The transport is deliberately resilient rather than transparent: a dropped connection is retried
 * with a growing backoff and calls made meanwhile are queued, because the desktop app on the other
 * end keeps running and this browser is expected to catch up rather than fail the whole session.
 */
export class RemoteBridgeClient {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly queue: QueuedRequest[] = [];
  private readonly listeners = new Map<string, Set<EventHandler>>();
  private readonly stateHandlers = new Set<StateHandler>();
  private readonly reconnectedHandlers = new Set<() => void>();

  private socket: RemoteSocket | null = null;
  private token: string | null = null;
  private stateValue: RemoteConnectionState = 'idle';
  private errorValue: string | null = null;
  private nextRequestId = 1;
  private reconnectAttempt = 0;
  private establishedOnce = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly createSocket: RemoteSocketFactory = defaultSocketFactory) {}

  get state(): RemoteConnectionState {
    return this.stateValue;
  }

  get error(): string | null {
    return this.errorValue;
  }

  onStateChange(handler: StateHandler): UnlistenFn {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  /** Fires after a connection is restored, never after the first one is established. */
  onReconnected(handler: () => void): UnlistenFn {
    this.reconnectedHandlers.add(handler);
    return () => this.reconnectedHandlers.delete(handler);
  }

  /** Adopts a token and (re)connects with it; a null token leaves the client unauthorized. */
  setToken(token: string | null): void {
    if (!token) {
      this.forget();
      return;
    }
    if (this.token === token && this.stateValue !== 'unauthorized' && this.socket) {
      return;
    }
    this.token = token;
    this.errorValue = null;
    this.reconnectAttempt = 0;
    this.connect();
  }

  /** Drops the token, closes the socket and fails everything that was waiting on it. */
  forget(): void {
    this.token = null;
    this.clearReconnectTimer();
    this.dropConnection();
    this.rejectQueue(UNAUTHORIZED_ERROR);
    this.setState('unauthorized', this.errorValue);
  }

  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.token) {
      return Promise.reject(new Error(UNAUTHORIZED_ERROR));
    }
    return new Promise<T>((resolve, reject) => {
      const request = { command, args, resolve, reject } as unknown as QueuedRequest;
      if (this.stateValue === 'ready' && this.socket) {
        this.dispatch(request);
        return;
      }
      // Connecting or reconnecting: the call waits rather than failing, so a brief network blip
      // does not surface as an error in the UI.
      this.queue.push(request);
    });
  }

  listen<T>(event: string, handler: (event: BackendEvent<T>) => void): UnlistenFn {
    const handlers = this.listeners.get(event) ?? new Set<EventHandler>();
    handlers.add(handler as EventHandler);
    this.listeners.set(event, handlers);
    return () => {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  private connect(): void {
    if (!this.token) {
      return;
    }
    this.clearReconnectTimer();
    this.dropConnection();
    this.setState(this.establishedOnce ? 'reconnecting' : 'connecting', this.errorValue);

    let socket: RemoteSocket;
    try {
      socket = this.createSocket(bridgeUrl());
    } catch (error) {
      this.errorValue = error instanceof Error ? error.message : String(error);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => this.handleOpen();
    socket.onmessage = (event) => this.handleFrame(event.data);
    socket.onclose = () => this.handleDisconnect();
    // A socket error is always followed by a close, which is where the retry is scheduled.
    socket.onerror = () => undefined;
  }

  private handleOpen(): void {
    const token = this.token;
    if (!token) {
      this.dropConnection();
      return;
    }
    this.setState('authenticating', this.errorValue);
    this.send({ type: 'auth', token, clientId: runtimeClientId() });
    this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_INTERVAL_MS);
    this.restartIdleTimer();
  }

  private handleFrame(data: unknown): void {
    this.restartIdleTimer();
    let frame: RemoteServerFrame;
    try {
      frame = JSON.parse(String(data)) as RemoteServerFrame;
    } catch {
      // A frame this client cannot parse is not worth tearing the connection down for.
      return;
    }

    switch (frame.type) {
      case 'ready':
        this.handleReady();
        return;
      case 'auth-failed':
        this.handleAuthFailed(frame.reason);
        return;
      case 'result':
        this.settle(frame);
        return;
      case 'event':
        this.emit(frame.name, frame.payload);
        return;
      case 'resync':
        // The server dropped outbound frames for this connection; subscribers replay their state.
        this.emit(RESYNC_EVENT, undefined);
        return;
      default:
        return;
    }
  }

  private handleReady(): void {
    this.reconnectAttempt = 0;
    this.setState('ready', null);
    this.flushQueue();
    if (this.establishedOnce) {
      for (const handler of [...this.reconnectedHandlers]) {
        handler();
      }
      return;
    }
    this.establishedOnce = true;
  }

  private handleAuthFailed(reason: string): void {
    // A rejected token stays rejected, so retrying would only lock this address out of the server.
    this.token = null;
    this.clearReconnectTimer();
    this.dropConnection();
    this.rejectQueue(UNAUTHORIZED_ERROR);
    this.setState('unauthorized', reason || UNAUTHORIZED_ERROR);
  }

  private settle(frame: Extract<RemoteServerFrame, { type: 'result' }>): void {
    const request = this.pending.get(frame.id);
    if (!request) {
      return;
    }
    this.pending.delete(frame.id);
    if (frame.ok) {
      request.resolve(frame.value as never);
      return;
    }
    // Command errors pass through unchanged so callers see exactly what the desktop app sees.
    request.reject(frame.error);
  }

  private emit(name: string, payload: unknown): void {
    const handlers = this.listeners.get(name);
    if (!handlers) {
      return;
    }
    for (const handler of [...handlers]) {
      handler({ event: name, payload: payload as never });
    }
  }

  private dispatch(request: QueuedRequest): void {
    const id = this.nextRequestId++;
    this.pending.set(id, request);
    this.send({ type: 'invoke', id, command: request.command, args: request.args });
  }

  private flushQueue(): void {
    for (const request of this.queue.splice(0)) {
      this.dispatch(request);
    }
  }

  private rejectQueue(message: string): void {
    for (const request of this.queue.splice(0)) {
      request.reject(new Error(message));
    }
  }

  private rejectPending(message: string): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) {
      request.reject(new Error(message));
    }
  }

  private send(frame: unknown): void {
    try {
      this.socket?.send(JSON.stringify(frame));
    } catch {
      // A socket that refuses a write is already closing; the close handler schedules the retry.
    }
  }

  /** Closes the current socket without letting its own close handler run a second time. */
  private dropConnection(): void {
    const socket = this.socket;
    this.socket = null;
    this.stopTimers();
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // Closing an already-closed socket is not worth reporting.
      }
    }
    this.rejectPending(DISCONNECTED_ERROR);
  }

  private handleDisconnect(): void {
    this.dropConnection();
    if (!this.token) {
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.setState(this.establishedOnce ? 'reconnecting' : 'connecting', this.errorValue);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private restartIdleTimer(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => this.handleDisconnect(), IDLE_TIMEOUT_MS);
  }

  private stopTimers(): void {
    if (this.pingTimer !== undefined) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private setState(state: RemoteConnectionState, error: string | null): void {
    if (this.stateValue === state && this.errorValue === error) {
      return;
    }
    this.stateValue = state;
    this.errorValue = error;
    for (const handler of [...this.stateHandlers]) {
      handler(state, error);
    }
  }
}

let instance: RemoteBridgeClient | null = null;

/** The one client a remote session shares, connected with the token this browser holds. */
export function remoteBridgeClient(): RemoteBridgeClient {
  if (!instance) {
    instance = new RemoteBridgeClient();
    instance.setToken(resolveRemoteToken());
  }
  return instance;
}
