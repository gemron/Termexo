import { inject, Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
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

    await this.send(notification.title, notification.body);
  }

  /**
   * Raises a desktop notification that does not come from a terminal, such as a published
   * update. No taskbar flash: nothing here blocks the user's work.
   */
  async notifyMessage(title: string, body: string): Promise<void> {
    if (!this.appWindow) {
      return;
    }
    await this.send(title, body);
  }

  private async send(title: string, body: string): Promise<void> {
    if (!(await this.ensurePermission())) {
      // 无通知权限时降级为系统对话框
      void this.showDialogFallback(title, body);
      return;
    }

    try {
      // 走自有命令而非通知插件：插件会丢弃投递结果，失败时无法降级
      await invoke('show_desktop_notification', { title, body });
    } catch {
      // Toast 投递失败（例如 AUMID 未注册），降级为系统对话框
      void this.showDialogFallback(title, body);
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
