import { inject, Injectable, InjectionToken } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { message } from '@tauri-apps/plugin-dialog';

import { createDesktopNotification, GlobalTerminalNotice } from '../models/terminal-notifications';
import { I18nService } from '../i18n/i18n.service';
import { invoke } from './backend-bridge';
import { hasBackend, isTauriRuntime } from './tauri-runtime';

export const DESKTOP_NOTIFICATION_WINDOW = new InjectionToken<ReturnType<typeof getCurrentWindow> | null>('Desktop notification window', {
  providedIn: 'root', factory: () => isTauriRuntime() ? getCurrentWindow() : null,
});

@Injectable({ providedIn: 'root' })
export class DesktopNotificationService {
  private readonly i18n = inject(I18nService);
  private readonly appWindow = inject(DESKTOP_NOTIFICATION_WINDOW);
  private permissionPromise?: Promise<boolean>;
  private taskbarAttention: boolean | null = null;
  private attentionQueue: Promise<void> = Promise.resolve();

  constructor() {
    const appWindow = this.appWindow;
    if (!appWindow) {
      return;
    }

    void appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused && this.taskbarAttention) {
          // Activating the window does not acknowledge its pending messages.
          this.enqueueTaskbarAttention(true);
        }
      })
      .catch(() => undefined);
  }

  /** Includes completions until explicitly confirmed, independently of toast permissions. */
  syncTaskbarAttention(notices: readonly GlobalTerminalNotice[]): void {
    if (!this.appWindow) return;
    const active = notices.length > 0;
    if (this.taskbarAttention === active) return;
    this.taskbarAttention = active;
    this.enqueueTaskbarAttention(active);
  }

  private enqueueTaskbarAttention(active: boolean): void {
    // Start/stop requests must reach the native window in order, even during rapid status changes.
    this.attentionQueue = this.attentionQueue
      .then(() => invoke<void>('set_taskbar_attention', { active }))
      .catch((error: unknown) => {
        if (this.taskbarAttention === active) this.taskbarAttention = null;
        console.warn('Unable to update taskbar attention', error);
      });
  }

  async notify(notices: readonly GlobalTerminalNotice[]): Promise<void> {
    const notification = createDesktopNotification(notices, (key, params) =>
      this.i18n.t(key, params),
    );
    if (!notification) {
      return;
    }
    const appWindow = this.appWindow;
    if (!appWindow) {
      await this.sendBrowserNotification(notification.title, notification.body);
      return;
    }

    await this.send(notification.title, notification.body);
  }

  /**
   * Raises a desktop notification that does not come from a terminal, such as a published
   * update. No taskbar flash: nothing here blocks the user's work.
   */
  async notifyMessage(title: string, body: string): Promise<void> {
    if (!this.appWindow) {
      await this.sendBrowserNotification(title, body);
      return;
    }
    await this.send(title, body);
  }

  /**
   * Raises the notification through the browser on a device with no native window.
   *
   * A remote client cannot flash a taskbar it does not own, and the Notification API needs the
   * viewer's permission, so this is a best-effort fallback rather than a guaranteed delivery.
   */
  private async sendBrowserNotification(title: string, body: string): Promise<void> {
    if (!hasBackend() || typeof Notification === 'undefined') {
      return;
    }
    try {
      const permission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    } catch {
      // Notifications can be blocked outright, for example outside a secure context.
    }
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
