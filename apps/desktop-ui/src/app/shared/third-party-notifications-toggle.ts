import { Component, computed, inject, output, signal } from '@angular/core';
import '../core/i18n/workspace-tools.i18n';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { ThirdPartyNotificationsService } from '../core/services/third-party-notifications.service';
import { runtimeMode } from '../core/services/tauri-runtime';
import { IconComponent } from './icon/icon';

@Component({
  selector: 'app-third-party-notifications-toggle',
  imports: [IconComponent, TranslatePipe],
  template: `
    <button type="button" role="switch" [attr.aria-label]="'thirdParty.label' | t"
      data-testid="third-party-notifications-toggle"
      [attr.aria-checked]="flow.initialized() && flow.enabled()"
      [attr.aria-busy]="loading() || flow.saving()"
      [class.enabled]="flow.initialized() && flow.enabled()"
      [disabled]="!available || loading() || flow.saving()"
      [title]="hint()" (click)="toggle()">
      <app-icon name="bell" [size]="15" />
      <span>{{ 'thirdParty.label' | t }}</span>
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
  private readonly i18n = inject(I18nService);
  protected readonly flow = inject(ThirdPartyNotificationsService);
  protected readonly available = runtimeMode() === 'desktop';
  protected readonly loading = signal(false);
  private readonly error = signal('');
  readonly failed = output<string>();
  protected readonly hint = computed(() => {
    if (!this.available) return this.i18n.t('thirdParty.desktopOnly');
    if (this.loading()) return this.i18n.t('thirdParty.loading');
    if (this.flow.saving()) return this.i18n.t('thirdParty.saving');
    if (this.error()) return this.i18n.t('thirdParty.retry', { error: this.error() });
    return this.i18n.t(this.flow.enabled() ? 'thirdParty.enabled' : 'thirdParty.paused');
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
    const message = this.i18n.t('thirdParty.failed', { error: String(error) });
    this.error.set(message);
    this.failed.emit(message);
  }
}
