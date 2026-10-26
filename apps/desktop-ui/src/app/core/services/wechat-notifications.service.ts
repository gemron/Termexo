import { inject, Injectable, signal } from '@angular/core';
import type { AgentEvent } from '../models/agent.models';
import type { TodoWorkspaceSnapshot } from '../models/todo.models';
import type { Workspace } from '../models/workspace.models';
import {
  DEFAULT_WECHAT_SETTINGS,
  WechatEventTracker,
  type WechatDelivery,
  type WechatNotification,
  type WechatSettings,
} from '../models/wechat-notifications';
import { invoke } from './backend-bridge';
import { runtimeMode } from './tauri-runtime';
import { ThirdPartyNotificationsService } from './third-party-notifications.service';

@Injectable({ providedIn: 'root' })
export class WechatNotificationsService {
  private readonly notifications = inject(ThirdPartyNotificationsService);
  readonly settings = signal<WechatSettings>({ ...DEFAULT_WECHAT_SETTINGS });
  readonly history = signal<WechatDelivery[]>([]);
  readonly error = signal('');
  readonly initialized = signal(false);
  private readonly tracker = new WechatEventTracker();
  private queue: Promise<void> = Promise.resolve();

  async initialize(): Promise<void> {
    if (runtimeMode() !== 'desktop') return;
    await this.refresh();
    this.initialized.set(true);
  }
  async refresh(): Promise<void> {
    const value = await invoke<{ settings: WechatSettings; history: WechatDelivery[] }>(
      'read_wechat_notifications',
    );
    this.settings.set(value.settings);
    this.history.set(value.history);
  }
  async save(settings: WechatSettings): Promise<void> {
    this.settings.set(
      await invoke<WechatSettings>('update_wechat_notifications', { input: settings }),
    );
  }
  probe(target: string): Promise<{ status: string; detail: string }> {
    return invoke('probe_wechat_notification_target', { target });
  }
  observe(
    workspaces: readonly Workspace[],
    snapshots: Record<string, TodoWorkspaceSnapshot>,
    events: readonly AgentEvent[],
  ): void {
    if (!this.initialized()) return;
    const settings = this.settings();
    for (const notification of this.tracker.collect(workspaces, snapshots, events)) {
      if (
        !this.notifications.canSend() ||
        !settings.enabled ||
        (!settings.allWorkspaces && !settings.workspaceIds.includes(notification.workspaceId))
      )
        continue;
      const enabled = notification.kind === 'error' ? settings.errors : settings[notification.kind];
      if (!enabled) continue;
      const generation = this.notifications.generation();
      this.queue = this.queue.then(async () => {
        if (!this.notifications.canSend() || this.notifications.generation() !== generation) return;
        try {
          await this.send(notification);
        } catch (error) {
          this.error.set(String(error));
        }
      });
    }
  }
  async send(request: WechatNotification): Promise<WechatDelivery> {
    this.error.set('');
    const delivery = await invoke<WechatDelivery>('send_wechat_notification', { request });
    this.history.update((items) =>
      [delivery, ...items.filter((item) => item.id !== delivery.id)].slice(0, 50),
    );
    if (delivery.status !== 'submitted') this.error.set(delivery.detail);
    return delivery;
  }
}
