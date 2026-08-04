import { inject, Injectable } from '@angular/core';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { message } from '@tauri-apps/plugin-dialog';

import { createDesktopNotification, GlobalTerminalNotice } from '../models/terminal-notifications';
import { I18nService } from '../i18n/i18n.service';
import { isTauriRuntime } from './tauri-runtime';

@Injectable({ providedIn: 'root' })
export class DesktopNotificationService {
  private readonly i18n = inject(I18nService);
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
    const notification = createDesktopNotification(notices, (key, params) =>
      this.i18n.t(key, params),
    );
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
      // 无通知权限时降级为系统对话框
      void this.showDialogFallback(notification.title, notification.body);
      return;
    }

    try {
      sendNotification({ title: notification.title, body: notification.body });
    } catch {
      // Toast 通知失败（常见于未安装→无 AUMID），降级为系统对话框
      void this.showDialogFallback(notification.title, notification.body);
    }
  }

  /** 使用系统对话框作为 Toast 通知的降级方案 */
  private async showDialogFallback(title: string, body: string): Promise<void> {
    try {
      await message(`${title}\n\n${body}`, { title: 'Termexo', kind: 'info' });
    } catch {
      // 对话框也失败时静默忽略——in-app 通知仍然可用
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
