import { Injectable } from '@angular/core';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

import { createDesktopNotification, GlobalTerminalNotice } from '../models/terminal-notifications';
import { isTauriRuntime } from './tauri-runtime';

@Injectable({ providedIn: 'root' })
export class DesktopNotificationService {
  private readonly appWindow = isTauriRuntime() ? getCurrentWindow() : null;
  private permissionPromise?: Promise<boolean>;

  constructor() {
    const appWindow = this.appWindow;
    if (!appWindow) {
      return;
    }

    void appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          void appWindow.requestUserAttention(null).catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }

  async notify(notices: readonly GlobalTerminalNotice[]): Promise<void> {
    const notification = createDesktopNotification(notices);
    const appWindow = this.appWindow;
    if (!notification || !appWindow) {
      return;
    }

    // Waiting-for-approval and waiting-for-input must never be missed, so the window focus
    // state is deliberately not checked: the taskbar flash and the system notification are
    // always requested, and the operating system ignores the flash for a foreground window.
    const attentionType =
      notification.attention === 'critical'
        ? UserAttentionType.Critical
        : UserAttentionType.Informational;
    void appWindow.requestUserAttention(attentionType).catch(() => undefined);

    if (!(await this.ensurePermission())) {
      return;
    }

    try {
      sendNotification({ title: notification.title, body: notification.body });
    } catch {
      // Native notifications are best-effort; the in-app notice remains available.
    }
  }

  private async ensurePermission(): Promise<boolean> {
    // Concurrent notifications share one permission request, but a denial is not cached so
    // that re-enabling notifications in the system settings restores them without a restart.
    const granted = await (this.permissionPromise ??= this.requestNotificationPermission());
    if (!granted) {
      this.permissionPromise = undefined;
    }
    return granted;
  }

  private async requestNotificationPermission(): Promise<boolean> {
    try {
      return (await isPermissionGranted()) || (await requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
}
