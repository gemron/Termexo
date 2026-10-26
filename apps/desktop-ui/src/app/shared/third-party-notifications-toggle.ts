import { Component, computed, inject, output, signal } from '@angular/core';
import { ThirdPartyNotificationsService } from '../core/services/third-party-notifications.service';
import { runtimeMode } from '../core/services/tauri-runtime';
import { IconComponent } from './icon/icon';

@Component({
  selector: 'app-third-party-notifications-toggle',
  imports: [IconComponent],
  template: `
    <button type="button" role="switch" aria-label="第三方通知"
      data-testid="third-party-notifications-toggle"
      [attr.aria-checked]="flow.initialized() && flow.enabled()"
      [attr.aria-busy]="loading() || flow.saving()"
      [class.enabled]="flow.initialized() && flow.enabled()"
      [disabled]="!available || loading() || flow.saving()"
      [title]="hint()" (click)="toggle()">
      <app-icon name="bell" [size]="15" />
      <span>第三方通知</span>
      <span class="switch-track" aria-hidden="true"><i></i></span>
    </button>
  `,
  styles: `
    :host { display: inline-flex; }
    button { display: inline-flex; align-items: center; gap: 6px; min-height: 28px;
      padding: 0 8px; border: 0; border-radius: 3px; color: var(--text-secondary);
      background: transparent; font-size: 11px; white-space: nowrap; }
    button:hover, button:focus-visible { color: var(--text); background: var(--surface-2); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .switch-track { display: inline-flex; align-items: center; width: 24px; height: 14px;
      padding: 2px; border-radius: 999px; background: var(--text-muted); }
    i { width: 10px; height: 10px; border-radius: 50%; background: var(--surface-0);
      transition: transform .15s; }
    .enabled .switch-track { background: var(--color-success); }
    .enabled i { transform: translateX(10px); }
    @media (prefers-reduced-motion: reduce) { i { transition: none; } }
  `,
})
export class ThirdPartyNotificationsToggleComponent {
  protected readonly flow = inject(ThirdPartyNotificationsService);
  protected readonly available = runtimeMode() === 'desktop';
  protected readonly loading = signal(false);
  private readonly error = signal('');
  readonly failed = output<string>();
  protected readonly hint = computed(() => {
    if (!this.available) return '请在桌面端切换第三方通知';
    if (this.loading()) return '正在读取第三方通知总开关…';
    if (this.flow.saving()) return '正在保存第三方通知总开关…';
    if (this.error()) return this.error() + '；点击重试';
    return this.flow.enabled()
      ? '第三方通知已开启，点击暂停所有渠道；各渠道配置会保留'
      : '第三方通知已暂停，点击按各渠道原有配置恢复';
  });

  constructor() {
    if (this.available) void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      await this.flow.initialize();
      this.error.set('');
    } catch (error) {
      this.report(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected async toggle(): Promise<void> {
    if (!this.available || this.loading() || this.flow.saving()) return;
    if (!this.flow.initialized()) { await this.load(); return; }
    try {
      await this.flow.setEnabled(!this.flow.enabled());
      this.error.set('');
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    const message = '第三方通知开关操作失败：' + String(error);
    this.error.set(message);
    this.failed.emit(message);
  }
}
