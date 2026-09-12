import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ConsoleApiService } from '../core/console-api.service';
import { describeConsoleError } from '../core/console-error';
import { registerRelayConsoleTranslations } from '../core/console.i18n';
import type { AuditView, DeviceView, UpstreamView } from '../core/console.models';
import { SessionService } from '../core/session.service';
import { formatMoment, formatText } from '../shared/format';
import { PageState, StateBlockComponent } from '../shared/state-block';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';
import { DeviceTableComponent } from './device-table';

// Registered at module scope so the wording is in place before the component is built.
registerRelayConsoleTranslations();

/** Enough recent events to tell whether anything happened, not enough to become a second page. */
const RECENT_AUDIT_LIMIT = 6;

const UPSTREAM_STATE_KEYS: Readonly<Record<UpstreamView['state'], string>> = {
  disabled: 'console.relays.stateDisabled',
  connecting: 'console.relays.stateConnecting',
  connected: 'console.relays.stateConnected',
  error: 'console.relays.stateError',
};

@Component({
  selector: 'console-overview-page',
  imports: [DeviceTableComponent, RouterLink, StateBlockComponent, TranslatePipe],
  template: `
    <header class="page-header">
      <div>
        <h1>{{ 'console.overview.title' | t }}</h1>
        <p>
          {{ (isAdmin() ? 'console.overview.subtitleAdmin' : 'console.overview.subtitleUser') | t }}
        </p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn" [disabled]="loading()" (click)="reload()">
          {{ 'console.common.refresh' | t }}
        </button>
      </div>
    </header>

    @if (state() !== 'ready') {
      <console-state-block [state]="state()" [error]="error()" (retry)="reload()" />
    } @else {
      <div class="card">
        <dl class="stat-grid">
          <div class="stat">
            <dt>{{ 'console.overview.devicesOnline' | t }}</dt>
            <dd>{{ onlineCount() }}</dd>
          </div>
          <div class="stat">
            <dt>{{ 'console.overview.devicesTotal' | t }}</dt>
            <dd>{{ devices().length }}</dd>
          </div>
          @if (isAdmin()) {
            <div class="stat">
              <dt>{{ 'console.overview.users' | t }}</dt>
              <dd>{{ userCount() }}</dd>
            </div>
            <div class="stat">
              <dt>{{ 'console.overview.upstream' | t }}</dt>
              <dd>
                <span class="status" [attr.data-tone]="upstreamTone()">{{ upstreamLabel() }}</span>
              </dd>
            </div>
          }
        </dl>
      </div>

      <div class="card">
        <h2>{{ 'console.overview.myDevices' | t }}</h2>
        @if (devices().length === 0) {
          <console-state-block
            state="empty"
            [emptyTitle]="'console.devices.empty' | t"
            [emptyHelp]="emptyHelp()"
          />
        } @else {
          <console-device-table [devices]="devices()" [detailed]="isAdmin()" />
          <div class="form-actions">
            <a class="btn" routerLink="/devices">{{ 'console.overview.viewAll' | t }}</a>
          </div>
        }
      </div>

      @if (isAdmin()) {
        <div class="card">
          <h2>{{ 'console.overview.recentAudit' | t }}</h2>
          @if (recentAudit().length === 0) {
            <console-state-block
              state="empty"
              [emptyTitle]="'console.audit.empty' | t"
              [emptyHelp]="'console.audit.emptyHelp' | t"
            />
          } @else {
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>{{ 'console.audit.time' | t }}</th>
                    <th>{{ 'console.audit.action' | t }}</th>
                    <th>{{ 'console.audit.target' | t }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (event of recentAudit(); track event.id) {
                    <tr>
                      <td>{{ moment(event.at) }}</td>
                      <td class="cell-name">{{ event.action }}</td>
                      <td class="cell-mono">{{ text(event.targetId) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="form-actions">
              <a class="btn" routerLink="/audit">{{ 'console.overview.viewAll' | t }}</a>
            </div>
          }
        </div>
      }
    }
  `,
})
export class OverviewPageComponent {
  private readonly api = inject(ConsoleApiService);
  private readonly session = inject(SessionService);
  private readonly i18n = inject(I18nService);

  protected readonly devices = signal<DeviceView[]>([]);
  protected readonly userCount = signal(0);
  protected readonly upstream = signal<UpstreamView | null>(null);
  protected readonly recentAudit = signal<AuditView[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  protected readonly isAdmin = this.session.isAdmin;
  protected readonly text = formatText;

  protected readonly state = computed<PageState>(() => {
    if (this.loading()) return 'loading';
    return this.error() ? 'error' : 'ready';
  });

  protected readonly onlineCount = computed(
    () => this.devices().filter((device) => device.online).length,
  );

  protected readonly emptyHelp = computed(() =>
    this.i18n.t(
      this.isAdmin() ? 'console.devices.emptyHelpAdmin' : 'console.devices.emptyHelpUser',
    ),
  );

  protected readonly upstreamLabel = computed(() => {
    const upstream = this.upstream();
    return upstream
      ? this.i18n.t(UPSTREAM_STATE_KEYS[upstream.state])
      : this.i18n.t('console.relays.stateDisabled');
  });

  protected readonly upstreamTone = computed(() => {
    const state = this.upstream()?.state;
    if (state === 'connected') return 'online';
    return state === 'error' ? 'danger' : 'neutral';
  });

  constructor() {
    void this.load();
  }

  protected reload(): void {
    void this.load();
  }

  protected moment(value: number): string {
    return formatMoment(value, this.i18n.locale());
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await (this.isAdmin() ? this.loadForAdmin() : this.loadForUser());
    } catch (error) {
      this.error.set(
        this.i18n.t('console.common.loadFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async loadForAdmin(): Promise<void> {
    // One round trip's worth of latency for the whole page instead of four in a row.
    const [devices, users, topology, audit] = await Promise.all([
      this.api.listAllDevices(),
      this.api.listUsers(),
      this.api.relayTopology(),
      this.api.listAudit({ limit: RECENT_AUDIT_LIMIT }),
    ]);
    this.devices.set(devices);
    this.userCount.set(users.length);
    this.upstream.set(topology.upstream);
    this.recentAudit.set(audit);
  }

  private async loadForUser(): Promise<void> {
    this.devices.set(await this.api.listOwnDevices());
  }
}
