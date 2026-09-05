import { Injectable, signal } from '@angular/core';

import { RemoteConnectionState } from '../models/remote-access.models';
import { getRemoteClient } from './backend-bridge';
import type { RemoteBridgeClient } from './remote-bridge-client';
import { clearRemoteToken, resolveRemoteToken, storeRemoteToken } from './remote-token';
import { RuntimeMode, runtimeMode } from './tauri-runtime';

/**
 * Exposes the remote WebSocket bridge to the UI as signals.
 *
 * Everything below the transport stays unaware of the connection: only the gate and the status
 * badge need to know whether the browser is authorized, connecting or catching up again.
 */
@Injectable({ providedIn: 'root' })
export class RemoteConnectionService {
  readonly mode: RuntimeMode = runtimeMode();

  private readonly stateValue = signal<RemoteConnectionState>('idle');
  private readonly errorValue = signal<string | null>(null);
  private readonly storedTokenValue = signal(false);
  private readonly reconnectedHandlers = new Set<() => void>();
  private clientPromise: Promise<RemoteBridgeClient> | null = null;

  readonly state = this.stateValue.asReadonly();
  readonly error = this.errorValue.asReadonly();
  readonly hasStoredToken = this.storedTokenValue.asReadonly();

  constructor() {
    if (this.mode !== 'remote') {
      return;
    }
    // Resolving here strips a token carried in the URL as early as possible, before any component
    // can render an address bar screenshot or a shareable link with it still attached.
    this.storedTokenValue.set(Boolean(resolveRemoteToken()));
    void this.client();
  }

  /** Stores a token the user typed and reconnects with it. */
  submitToken(token: string): void {
    const normalized = token.trim();
    if (!normalized) {
      return;
    }
    storeRemoteToken(normalized);
    this.storedTokenValue.set(true);
    this.errorValue.set(null);
    void this.client().then((client) => client.setToken(normalized));
  }

  /** Forgets the token and drops the connection, sending the user back to the token gate. */
  forget(): void {
    clearRemoteToken();
    this.storedTokenValue.set(false);
    void this.client().then((client) => client.forget());
  }

  /** Runs `handler` after a dropped connection is restored, never after the first connect. */
  onReconnected(handler: () => void): () => void {
    this.reconnectedHandlers.add(handler);
    return () => this.reconnectedHandlers.delete(handler);
  }

  private client(): Promise<RemoteBridgeClient> {
    return (this.clientPromise ??= this.attach());
  }

  private async attach(): Promise<RemoteBridgeClient> {
    const client = await getRemoteClient();
    client.onStateChange((state, error) => this.applyState(state, error));
    client.onReconnected(() => {
      for (const handler of [...this.reconnectedHandlers]) {
        handler();
      }
    });
    this.applyState(client.state, client.error);
    return client;
  }

  private applyState(state: RemoteConnectionState, error: string | null): void {
    this.stateValue.set(state);
    this.errorValue.set(error);
    if (state === 'unauthorized') {
      // A token the server rejected is worse than no token: keeping it would retry on every reload
      // and count against the failed-attempt lockout for this address.
      clearRemoteToken();
      this.storedTokenValue.set(false);
    }
  }
}
