import { Injectable, signal } from '@angular/core';

import { invoke } from './backend-bridge';
import { hasBackend } from './tauri-runtime';

/**
 * The pseudo console the backend opens terminals with.
 *
 * Only ConPTY exists on Windows, but which one — the copy shipped beside the executable or the
 * one the user's Windows build carries — changes what the terminal may safely do for itself.
 */
export interface PtyBackend {
  readonly backend: 'conpty';
  readonly buildNumber: number;
  readonly bundled: boolean;
}

/**
 * Reports the pseudo console once per session.
 *
 * It cannot change while the app runs, so the answer is fetched on construction and read from a
 * signal afterwards: a terminal that mounts before the answer arrives picks it up when it does,
 * rather than each panel asking the backend again.
 */
@Injectable({ providedIn: 'root' })
export class PtyBackendService {
  private readonly state = signal<PtyBackend | null>(null);

  /** Null until the backend answers, and in the browser preview, which has no PTY at all. */
  readonly backend = this.state.asReadonly();

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    if (!hasBackend()) {
      return;
    }
    try {
      this.state.set(await invoke<PtyBackend>('get_pty_backend'));
    } catch (error) {
      // xterm's own defaults are the right fallback, so a failure here costs nothing but the
      // tuning; it must not stop a terminal from opening.
      console.warn('Pseudo console lookup failed', error);
    }
  }
}
