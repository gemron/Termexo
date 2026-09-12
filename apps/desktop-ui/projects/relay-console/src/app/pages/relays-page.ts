import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ConsoleApiService } from '../core/console-api.service';
import { describeConsoleError } from '../core/console-error';
import { registerRelayConsoleTranslations } from '../core/console.i18n';
import type { DownstreamView, RelaySettingsView, UpstreamView } from '../core/console.models';
import { ToastService } from '../core/toast.service';
import { ConfirmBlockComponent } from '../shared/confirm-block';
import { PageState, StateBlockComponent } from '../shared/state-block';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';

// Registered at module scope so the wording is in place before the component is built.
registerRelayConsoleTranslations();

const RELAY_URL_PATTERN = /^https?:\/\/\S+$/i;

const UPSTREAM_STATE_KEYS: Readonly<Record<UpstreamView['state'], string>> = {
  disabled: 'console.relays.stateDisabled',
  connecting: 'console.relays.stateConnecting',
  connected: 'console.relays.stateConnected',
  error: 'console.relays.stateError',
};

@Component({
  selector: 'console-relays-page',
  imports: [ConfirmBlockComponent, FormsModule, StateBlockComponent, TranslatePipe],
  template: `
    <header class="page-header">
      <div>
        <h1>{{ 'console.relays.title' | t }}</h1>
        <p>{{ 'console.relays.subtitle' | t }}</p>
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
      @if (settings(); as relay) {
        <div class="card">
          <h2>{{ 'console.relays.self' | t }}</h2>
          <dl class="facts">
            <div>
              <dt>{{ 'console.relays.relayId' | t }}</dt>
              <dd>{{ relay.relayId }}</dd>
            </div>
            <div>
              <dt>{{ 'console.relays.publicUrl' | t }}</dt>
              <dd>{{ relay.publicUrl }}</dd>
            </div>
            <div>
              <dt>{{ 'console.relays.version' | t }}</dt>
              <dd>{{ relay.version }}</dd>
            </div>
          </dl>
        </div>
      }

      <div class="card">
        <h2>{{ 'console.relays.upstream' | t }}</h2>

        @if (upstream(); as link) {
          <dl class="facts">
            <div>
              <dt>{{ 'console.relays.state' | t }}</dt>
              <dd>
                <span class="status" [attr.data-tone]="upstreamTone()">{{ stateLabel() }}</span>
              </dd>
            </div>
            <div>
              <dt>{{ 'console.relays.upstreamUrl' | t }}</dt>
              <dd>{{ link.url }}</dd>
            </div>
            <div>
              <dt>{{ 'console.relays.upstreamRelayId' | t }}</dt>
              <dd>{{ link.relayId ?? ('console.common.none' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'console.relays.chain' | t }}</dt>
              <dd>{{ chainLabel() }}</dd>
            </div>
          </dl>

          @if (link.error) {
            <div class="alert error" role="alert">{{ link.error }}</div>
          }

          @if (confirmingDisconnect()) {
            <console-confirm
              [message]="'console.relays.disconnectConfirm' | t"
              [confirmLabel]="'console.relays.disconnectAction' | t"
              [busy]="acting()"
              (confirmed)="disconnect()"
              (cancelled)="confirmingDisconnect.set(false)"
            />
          } @else {
            <div class="form-actions">
              <button
                type="button"
                class="btn btn-danger"
                [disabled]="acting()"
                (click)="confirmingDisconnect.set(true)"
              >
                {{ 'console.relays.disconnect' | t }}
              </button>
            </div>
          }
        } @else {
          <p class="state-block">
            <strong>{{ 'console.relays.upstreamNone' | t }}</strong>
            <span>{{ 'console.relays.upstreamNoneHint' | t }}</span>
          </p>

          @if (formError()) {
            <div class="alert error" role="alert">{{ formError() }}</div>
          }

          <form (ngSubmit)="connect()">
            <div class="field-row">
              <label class="field">
                <span>{{ 'console.relays.upstreamUrl' | t }}</span>
                <input
                  name="url"
                  type="url"
                  inputmode="url"
                  spellcheck="false"
                  placeholder="https://relay.example.com"
                  [disabled]="acting()"
                  [attr.aria-invalid]="urlInvalid() ? 'true' : null"
                  [ngModel]="url()"
                  (ngModelChange)="url.set($event)"
                />
              </label>
              <label class="field">
                <span>{{ 'console.relays.upstreamCode' | t }}</span>
                <input
                  name="code"
                  type="text"
                  spellcheck="false"
                  autocomplete="off"
                  [disabled]="acting()"
                  [ngModel]="code()"
                  (ngModelChange)="code.set($event)"
                />
              </label>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" [disabled]="!canConnect()">
                {{ (acting() ? 'console.relays.connecting' : 'console.relays.connect') | t }}
              </button>
            </div>
          </form>
        }
      </div>

      <div class="card">
        <h2>{{ 'console.relays.downstream' | t }}</h2>
        @if (downstreams().length === 0) {
          <console-state-block
            state="empty"
            [emptyTitle]="'console.relays.downstreamEmpty' | t"
            [emptyHelp]="'console.relays.downstreamEmptyHelp' | t"
          />
        } @else {
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>{{ 'console.devices.name' | t }}</th>
                  <th>{{ 'console.devices.status' | t }}</th>
                  <th>{{ 'console.relays.deviceCount' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (relay of downstreams(); track relay.deviceId) {
                  <tr>
                    <td class="cell-name">{{ relay.name }}</td>
                    <td>
                      <span class="status" [attr.data-tone]="relay.online ? 'online' : 'neutral'">
                        {{
                          (relay.online ? 'console.devices.online' : 'console.devices.offline') | t
                        }}
                      </span>
                    </td>
                    <td>{{ relay.deviceCount }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }
  `,
})
export class RelaysPageComponent {
  private readonly api = inject(ConsoleApiService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly upstream = signal<UpstreamView | null>(null);
  protected readonly settings = signal<RelaySettingsView | null>(null);
  protected readonly downstreams = signal<DownstreamView[]>([]);
  protected readonly loading = signal(true);
  protected readonly acting = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  protected readonly confirmingDisconnect = signal(false);

  protected readonly url = signal('');
  protected readonly code = signal('');

  protected readonly state = computed<PageState>(() => {
    if (this.loading()) return 'loading';
    return this.error() ? 'error' : 'ready';
  });

  protected readonly urlInvalid = computed(() => {
    const value = this.url().trim();
    return value.length > 0 && !RELAY_URL_PATTERN.test(value);
  });

  protected readonly canConnect = computed(
    () =>
      !this.acting() &&
      this.url().trim().length > 0 &&
      !this.urlInvalid() &&
      this.code().trim().length > 0,
  );

  protected readonly stateLabel = computed(() => {
    const link = this.upstream();
    return this.i18n.t(link ? UPSTREAM_STATE_KEYS[link.state] : 'console.relays.stateDisabled');
  });

  protected readonly upstreamTone = computed(() => {
    const state = this.upstream()?.state;
    if (state === 'connected') return 'online';
    return state === 'error' ? 'danger' : 'neutral';
  });

  protected readonly chainLabel = computed(() => {
    const chain = this.upstream()?.chain ?? [];
    return chain.length > 0 ? chain.join(' → ') : this.i18n.t('console.common.none');
  });

  constructor() {
    void this.load();
  }

  protected reload(): void {
    void this.load();
  }

  protected async connect(): Promise<void> {
    if (!this.canConnect()) {
      return;
    }
    this.acting.set(true);
    this.formError.set('');
    try {
      await this.api.connectUpstream(this.url().trim(), this.code().trim());
      this.code.set('');
      this.toasts.success(this.i18n.t('console.relays.connected'));
      await this.load();
    } catch (error) {
      this.formError.set(this.describeUpstreamError(error));
    } finally {
      this.acting.set(false);
    }
  }

  protected async disconnect(): Promise<void> {
    this.acting.set(true);
    try {
      await this.api.disconnectUpstream();
      this.confirmingDisconnect.set(false);
      this.toasts.success(this.i18n.t('console.relays.disconnected'));
      await this.load();
    } catch (error) {
      this.toasts.error(this.describeUpstreamError(error));
    } finally {
      this.acting.set(false);
    }
  }

  /** The relay's own sentence explains why a code or an address was refused, so it is shown as is. */
  private describeUpstreamError(error: unknown): string {
    return this.i18n.t('console.common.actionFailed', { error: describeConsoleError(error) });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      // The relay's own identity is what an operator needs in hand before wiring a chain, so
      // it is fetched alongside the topology rather than on a page of its own.
      const [topology, settings] = await Promise.all([
        this.api.relayTopology(),
        this.api.relaySettings(),
      ]);
      this.upstream.set(topology.upstream);
      this.downstreams.set(topology.downstreams);
      this.settings.set(settings);
    } catch (error) {
      this.error.set(
        this.i18n.t('console.common.loadFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.loading.set(false);
    }
  }
}
