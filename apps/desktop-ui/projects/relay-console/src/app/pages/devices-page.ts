import { Component, computed, inject, signal } from '@angular/core';

import { ConsoleApiService } from '../core/console-api.service';
import { describeConsoleError } from '../core/console-error';
import { registerRelayConsoleTranslations } from '../core/console.i18n';
import type { DevicePatch, DeviceView } from '../core/console.models';
import { SessionService } from '../core/session.service';
import { ToastService } from '../core/toast.service';
import { pollWhileAlive } from '../shared/polling';
import { PageState, StateBlockComponent } from '../shared/state-block';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';
import { DeviceDrawerComponent } from './device-drawer';
import { DeviceTableComponent } from './device-table';

// Registered at module scope so the wording is in place before the component is built.
registerRelayConsoleTranslations();

/** The design calls for ten seconds: often enough to watch a device come up, cheap enough to poll. */
const DEVICE_POLL_MS = 10_000;

@Component({
  selector: 'console-devices-page',
  imports: [DeviceDrawerComponent, DeviceTableComponent, StateBlockComponent, TranslatePipe],
  template: `
    <header class="page-header">
      <div>
        <h1>{{ 'console.devices.title' | t }}</h1>
        <p>{{ 'console.devices.subtitle' | t }}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn" [disabled]="refreshing()" (click)="reload()">
          {{ 'console.common.refresh' | t }}
        </button>
      </div>
    </header>

    @if (state() === 'ready') {
      <div class="card">
        <console-device-table
          [devices]="devices()"
          [detailed]="isAdmin()"
          (opened)="selectedId.set($event.id)"
        />
      </div>
    } @else {
      <console-state-block
        [state]="state()"
        [error]="error()"
        [emptyTitle]="'console.devices.empty' | t"
        [emptyHelp]="emptyHelp()"
        (retry)="reload()"
      />
    }

    @if (selected(); as device) {
      <console-device-drawer
        [device]="device"
        [canManage]="isAdmin()"
        [busy]="acting()"
        [error]="actionError()"
        (closed)="closeDrawer()"
        (saved)="save(device, $event)"
        (revoked)="revoke(device)"
        (disconnected)="disconnect(device)"
      />
    }
  `,
})
export class DevicesPageComponent {
  private readonly api = inject(ConsoleApiService);
  private readonly session = inject(SessionService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly devices = signal<DeviceView[]>([]);
  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly acting = signal(false);
  protected readonly error = signal('');
  protected readonly actionError = signal('');
  protected readonly selectedId = signal<string | null>(null);

  protected readonly isAdmin = this.session.isAdmin;

  protected readonly state = computed<PageState>(() => {
    if (this.loading()) return 'loading';
    if (this.error()) return 'error';
    return this.devices().length === 0 ? 'empty' : 'ready';
  });

  protected readonly emptyHelp = computed(() =>
    this.i18n.t(
      this.isAdmin() ? 'console.devices.emptyHelpAdmin' : 'console.devices.emptyHelpUser',
    ),
  );

  /** Read out of the list rather than copied, so a poll keeps the open drawer up to date. */
  protected readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? (this.devices().find((device) => device.id === id) ?? null) : null;
  });

  constructor() {
    void this.load(true);
    // A silent refresh: the table updates in place instead of flashing its loading state.
    pollWhileAlive(DEVICE_POLL_MS, () => void this.load(false));
  }

  protected reload(): void {
    void this.load(this.devices().length === 0);
  }

  protected async save(device: DeviceView, patch: DevicePatch): Promise<void> {
    await this.act(
      () => this.api.updateDevice(device.id, patch, this.isAdmin()),
      () => this.i18n.t('console.devices.renamed'),
    );
  }

  protected async revoke(device: DeviceView): Promise<void> {
    await this.act(
      () => this.api.revokeDevice(device.id, this.isAdmin()),
      () => this.i18n.t('console.devices.revokeDone', { name: device.name }),
    );
  }

  protected async disconnect(device: DeviceView): Promise<void> {
    await this.act(
      () => this.api.disconnectDevice(device.id),
      () => this.i18n.t('console.devices.disconnected'),
    );
  }

  protected closeDrawer(): void {
    this.selectedId.set(null);
    this.actionError.set('');
  }

  /** One shape for every drawer action: guard, report, refresh. */
  private async act(run: () => Promise<unknown>, success: () => string): Promise<void> {
    if (this.acting()) {
      return;
    }
    this.acting.set(true);
    this.actionError.set('');
    try {
      await run();
      this.toasts.success(success());
      await this.load(false);
    } catch (error) {
      this.actionError.set(
        this.i18n.t('console.common.actionFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.acting.set(false);
    }
  }

  private async load(showLoading: boolean): Promise<void> {
    if (showLoading) {
      this.loading.set(true);
    }
    this.refreshing.set(true);
    try {
      this.devices.set(
        this.isAdmin() ? await this.api.listAllDevices() : await this.api.listOwnDevices(),
      );
      this.error.set('');
    } catch (error) {
      // A failed poll must not wipe a table that is still perfectly readable.
      if (showLoading || this.devices().length === 0) {
        this.error.set(
          this.i18n.t('console.common.loadFailed', { error: describeConsoleError(error) }),
        );
      }
    } finally {
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }
}
