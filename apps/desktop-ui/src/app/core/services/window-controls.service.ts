import { Injectable, signal } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { isTauriRuntime } from './tauri-runtime';

/**
 * Drives the window buttons that stand in for the native title bar.
 *
 * The window is created undecorated so the topbar is the only chrome above the terminals, which
 * means minimising, maximising, and closing have to be offered here. The browser preview has no
 * window to control, so `available` is false there and the topbar leaves the buttons out rather
 * than showing controls that cannot work.
 */
@Injectable({ providedIn: 'root' })
export class WindowControlsService {
  private readonly appWindow = isTauriRuntime() ? getCurrentWindow() : null;
  private readonly maximizedState = signal(false);

  readonly available = this.appWindow !== null;
  readonly maximized = this.maximizedState.asReadonly();

  constructor() {
    const appWindow = this.appWindow;
    if (!appWindow) {
      return;
    }
    void this.syncMaximized();
    // Aero Snap, the double-click on the drag region, and Win+Up all resize the window without
    // going through these buttons, so the icon follows the window instead of the last click.
    void appWindow.onResized(() => void this.syncMaximized()).catch(() => undefined);
  }

  async minimize(): Promise<void> {
    await this.appWindow?.minimize();
  }

  async toggleMaximize(): Promise<void> {
    await this.appWindow?.toggleMaximize();
    await this.syncMaximized();
  }

  async close(): Promise<void> {
    await this.appWindow?.close();
  }

  /**
   * A failed read only leaves the icon showing the previous state, so it is swallowed rather than
   * surfaced — unlike the button actions, which the user is waiting on.
   */
  private async syncMaximized(): Promise<void> {
    if (!this.appWindow) {
      return;
    }
    try {
      this.maximizedState.set(await this.appWindow.isMaximized());
    } catch {
      // Keeps the last known state.
    }
  }
}
