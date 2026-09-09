import { computed, Injectable, signal } from '@angular/core';

import { invoke } from './backend-bridge';
import { runtimeMode } from './tauri-runtime';

/** The WebView2 runtime the desktop window renders in, as the backend reports it. */
export interface WebviewStatus {
  readonly version: string | null;
  readonly major: number | null;
  readonly minimumMajor: number;
  readonly supported: boolean;
  readonly downloadUrl: string;
}

/**
 * Reports whether the window's WebView2 runtime can render the interface.
 *
 * The runtime cannot change while the app runs, so it is read once on construction. A runtime
 * older than the minimum still draws a window, just one whose colours have quietly failed — the
 * notice this drives is the only thing that connects the two.
 */
@Injectable({ providedIn: 'root' })
export class WebviewStatusService {
  private readonly state = signal<WebviewStatus | null>(null);
  private readonly dismissed = signal(false);

  readonly status = this.state.asReadonly();

  /** True while the runtime is too old and the notice has not been put aside for this session. */
  readonly upgradeNeeded = computed(() => !this.dismissed() && this.state()?.supported === false);

  constructor() {
    void this.load();
  }

  /** Puts the notice aside until the next launch, which is when a new runtime would take effect. */
  dismiss(): void {
    this.dismissed.set(true);
  }

  /** Opens Microsoft's download page in the default browser. */
  async openDownloadPage(): Promise<void> {
    await invoke('open_webview_download');
  }

  private async load(): Promise<void> {
    // Only the desktop window is a WebView2. A remote client is the phone's own browser, and
    // telling it to install a runtime for a machine it is not running on would be nonsense.
    if (runtimeMode() !== 'desktop') {
      return;
    }
    try {
      this.state.set(await invoke<WebviewStatus>('get_webview_status'));
    } catch (error) {
      // A runtime that cannot be asked about is not a reason to withhold the workbench.
      console.warn('WebView2 runtime lookup failed', error);
    }
  }
}
