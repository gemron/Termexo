import { Component, computed, effect, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { formatRelativeTime } from '../core/i18n/relative-time';
import { registerRemoteTranslations } from '../core/i18n/remote.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import type {
  QrCodeImage,
  RelayAddress,
  RelayEnrollMethod,
  RelayLinkState,
  RemoteAccessAddress,
  RemoteAccessStatus,
} from '../core/models/remote-access.models';
import { RemoteAccessService } from '../core/services/remote-access.service';
import { runtimeMode } from '../core/services/tauri-runtime';
import { IconComponent } from '../shared/icon/icon';

registerRemoteTranslations();

/** Ports below 1024 are reserved for system services; the backend rejects them as well. */
const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_PORT = 7420;
const ALL_INTERFACES = '0.0.0.0';
const LOOPBACK_ADDRESS = '127.0.0.1';
/** How long a copy button keeps confirming before it returns to its label. */
const COPY_FEEDBACK_MS = 1800;
/** Tokens are long enough that a full-length mask would wrap; the field only signals "hidden". */
const MASK_LENGTH = 28;

/** Accepts anything that looks like an origin; the backend is the one that really validates it. */
const RELAY_URL_PATTERN = /^https?:\/\/\S+$/i;
/** Stands in for a field the relay has not filled in yet. */
const UNKNOWN_VALUE = '—';

/** How often, and for how long, a link that is still connecting is asked whether it settled. */
const RELAY_SETTLE_POLL_MS = 1000;
const RELAY_SETTLE_TIMEOUT_MS = 20_000;

const RELAY_STATE_LABEL_KEYS: Readonly<Record<RelayLinkState, string>> = {
  disabled: 'remote.relayStateDisabled',
  connecting: 'remote.relayStateConnecting',
  connected: 'remote.relayStateConnected',
  revoked: 'remote.relayStateRevoked',
  error: 'remote.relayStateError',
};

type CopyTarget = 'url' | 'token';
type ServiceState = 'running' | 'stopped' | 'failed';
type RelayEnrollMethodName = RelayEnrollMethod['method'];

/** One option in the bind-address selector or in the link-address selector. */
interface AddressOption {
  value: string;
  label: string;
  /** Set only for an address a relay announced; a LAN address is built from the saved settings. */
  relay?: RelayAddress;
}

@Component({
  selector: 'app-remote-access-panel',
  imports: [FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="profile-editor remote-panel">
      @if (loading()) {
        <p class="remote-loading">{{ 'remote.loading' | t }}</p>
      } @else if (loadError()) {
        <div class="remote-alert error" role="alert">
          <app-icon name="triangle-alert" [size]="14" />
          <span>{{ 'remote.loadFailed' | t: { error: loadError() } }}</span>
          <button type="button" class="secondary" (click)="reload()">
            {{ 'common.retry' | t }}
          </button>
        </div>
      } @else {
        <div class="network-intro">
          <div>
            <strong>{{ 'remote.title' | t }}</strong>
            <span>{{ 'remote.subtitle' | t }}</span>
          </div>
          <span class="remote-state" [attr.data-state]="serviceState()">
            <i></i>
            {{ serviceStateLabel() }}
          </span>
        </div>

        @if (readOnly) {
          <p class="remote-notice">
            <app-icon name="shield" [size]="13" />
            <span>{{ 'remote.readOnly' | t }}</span>
          </p>
        }

        @if (actionError()) {
          <div class="remote-alert error" role="alert">
            <app-icon name="triangle-alert" [size]="14" />
            <span>{{ actionError() }}</span>
          </div>
        }

        @if (serviceState() === 'failed') {
          <div class="remote-alert warning" role="status">
            <app-icon name="triangle-alert" [size]="14" />
            <span>{{ 'remote.startFailed' | t: { error: status()?.error ?? '' } }}</span>
          </div>
        }

        <section class="network-section">
          <h3>{{ 'remote.serviceSection' | t }}</h3>

          <div class="remote-switch">
            <div>
              <label class="checkbox-control">
                <input
                  type="checkbox"
                  [disabled]="readOnly || busy()"
                  [ngModel]="enabled()"
                  (ngModelChange)="enabled.set($event)"
                />
                <span>{{ 'remote.enable' | t }}</span>
              </label>
              <small class="field-hint">{{ 'remote.enableHint' | t }}</small>
            </div>
            <span class="remote-runtime">{{
              'remote.connectedClients' | t: { count: status()?.connectedClients ?? 0 }
            }}</span>
          </div>

          <div class="two-columns remote-fields">
            <label>
              <span>{{ 'remote.bindAddress' | t }}</span>
              <select
                [disabled]="readOnly || busy()"
                [ngModel]="bindAddress()"
                (ngModelChange)="bindAddress.set($event)"
              >
                @for (option of bindOptions(); track option.value) {
                  <option [value]="option.value">{{ option.label }}</option>
                }
              </select>
            </label>
            <label>
              <span>{{ 'remote.port' | t }}</span>
              <input
                type="number"
                inputmode="numeric"
                [min]="minPort"
                [max]="maxPort"
                [disabled]="readOnly || busy()"
                [attr.aria-invalid]="portInvalid() ? 'true' : null"
                [ngModel]="port()"
                (ngModelChange)="port.set($event)"
              />
              @if (portInvalid()) {
                <small class="field-error" role="alert">{{ 'remote.portInvalid' | t }}</small>
              } @else {
                <small class="field-hint">{{ 'remote.portHint' | t }}</small>
              }
            </label>
          </div>

          <!-- The apply button shares the last option's row rather than sitting alone below it. -->
          <div class="remote-apply">
            <div class="remote-tls">
              <label class="checkbox-control">
                <input
                  type="checkbox"
                  [disabled]="readOnly || busy()"
                  [ngModel]="tls()"
                  (ngModelChange)="tls.set($event)"
                />
                <span>{{ 'remote.https' | t }}</span>
              </label>
              <small class="field-hint">{{ 'remote.httpsHint' | t }}</small>
            </div>

            @if (!readOnly) {
              <div class="editor-actions">
                @if (dirty()) {
                  <small class="remote-dirty">{{ 'remote.unsaved' | t }}</small>
                }
                <button type="button" class="primary" [disabled]="!canSave()" (click)="save()">
                  {{ (saving() ? 'remote.saving' : 'remote.save') | t }}
                </button>
              </div>
            }
          </div>
        </section>

        <section class="network-section">
          <h3>{{ 'remote.relaySection' | t }}</h3>

          @if (relayState() === 'disabled') {
            <p class="field-hint">{{ 'remote.relayIntro' | t }}</p>

            @if (readOnly) {
              <p class="remote-empty">{{ 'remote.relayReadOnly' | t }}</p>
            } @else {
              <div class="two-columns remote-relay-fields">
                <label>
                  <span>{{ 'remote.relayUrl' | t }}</span>
                  <input
                    type="url"
                    inputmode="url"
                    spellcheck="false"
                    autocomplete="off"
                    [placeholder]="'remote.relayUrlPlaceholder' | t"
                    [disabled]="busy()"
                    [attr.aria-invalid]="relayUrlInvalid() ? 'true' : null"
                    [ngModel]="relayUrl()"
                    (ngModelChange)="relayUrl.set($event)"
                  />
                  @if (relayUrlInvalid()) {
                    <small class="field-error" role="alert">{{
                      'remote.relayUrlInvalid' | t
                    }}</small>
                  }
                </label>
                <label>
                  <span>{{ 'remote.relayDeviceName' | t }}</span>
                  <input
                    type="text"
                    autocomplete="off"
                    [placeholder]="'remote.relayDeviceNamePlaceholder' | t"
                    [disabled]="busy()"
                    [ngModel]="relayDeviceName()"
                    (ngModelChange)="relayDeviceName.set($event)"
                  />
                </label>
              </div>

              <!-- Two ways in, one at a time: a segmented pick shows both without a second field. -->
              <div class="remote-relay-method">
                <span>{{ 'remote.relayMethod' | t }}</span>
                <div
                  class="cli-installer"
                  role="group"
                  [attr.aria-label]="'remote.relayMethod' | t"
                >
                  <button
                    type="button"
                    [class.active]="relayMethod() === 'code'"
                    [attr.aria-pressed]="relayMethod() === 'code'"
                    [disabled]="busy()"
                    (click)="relayMethod.set('code')"
                  >
                    {{ 'remote.relayMethodCode' | t }}
                  </button>
                  <button
                    type="button"
                    [class.active]="relayMethod() === 'password'"
                    [attr.aria-pressed]="relayMethod() === 'password'"
                    [disabled]="busy()"
                    (click)="relayMethod.set('password')"
                  >
                    {{ 'remote.relayMethodPassword' | t }}
                  </button>
                </div>
              </div>

              @if (relayMethod() === 'code') {
                <div class="two-columns remote-relay-fields">
                  <label>
                    <span>{{ 'remote.relayCode' | t }}</span>
                    <input
                      type="text"
                      spellcheck="false"
                      autocomplete="off"
                      [placeholder]="'remote.relayCodePlaceholder' | t"
                      [disabled]="busy()"
                      [ngModel]="relayCode()"
                      (ngModelChange)="relayCode.set($event)"
                    />
                  </label>
                </div>
              } @else {
                <div class="two-columns remote-relay-fields">
                  <label>
                    <span>{{ 'remote.relayUsername' | t }}</span>
                    <input
                      type="text"
                      autocomplete="username"
                      spellcheck="false"
                      [disabled]="busy()"
                      [ngModel]="relayUsername()"
                      (ngModelChange)="relayUsername.set($event)"
                    />
                  </label>
                  <label>
                    <span>{{ 'remote.relayPassword' | t }}</span>
                    <input
                      type="password"
                      autocomplete="current-password"
                      [disabled]="busy()"
                      [ngModel]="relayPassword()"
                      (ngModelChange)="relayPassword.set($event)"
                    />
                    <small class="field-hint">{{ 'remote.relayPasswordHint' | t }}</small>
                  </label>
                </div>
              }

              @if (relayError()) {
                <div class="remote-alert error" role="alert">
                  <app-icon name="triangle-alert" [size]="14" />
                  <span>{{ relayError() }}</span>
                </div>
              }

              <div class="remote-relay-actions">
                <button
                  type="button"
                  class="primary"
                  [disabled]="!canEnrollRelay()"
                  (click)="enrollRelay()"
                >
                  {{ (enrolling() ? 'remote.relayEnrolling' : 'remote.relayEnroll') | t }}
                </button>
              </div>
            }
          } @else if (relayLink(); as link) {
            <div class="remote-relay-state">
              <span class="remote-state" [attr.data-state]="relayState()">
                <i></i>
                {{ relayStateLabel() }}
              </span>
              @if (relayConnectedSince(); as since) {
                <span class="remote-relay-since">{{ since }}</span>
              }
              <dl class="remote-relay-facts">
                <div>
                  <dt>{{ 'remote.relayDeviceName' | t }}</dt>
                  <dd>{{ link.deviceName || unknownValue }}</dd>
                </div>
                <div>
                  <dt>{{ 'remote.relayDeviceId' | t }}</dt>
                  <dd>{{ link.deviceId || unknownValue }}</dd>
                </div>
                <div>
                  <dt>{{ 'remote.relayUrl' | t }}</dt>
                  <dd>{{ status()?.settings?.relay?.url || unknownValue }}</dd>
                </div>
              </dl>
            </div>

            @if (link.state === 'revoked') {
              <div class="remote-alert warning" role="status">
                <app-icon name="triangle-alert" [size]="14" />
                <span>{{ 'remote.relayRevokedHint' | t }}</span>
              </div>
            } @else if (link.error) {
              <div class="remote-alert error" role="alert">
                <app-icon name="triangle-alert" [size]="14" />
                <span>{{ link.error }}</span>
              </div>
            }

            @if (relayError()) {
              <div class="remote-alert error" role="alert">
                <app-icon name="triangle-alert" [size]="14" />
                <span>{{ relayError() }}</span>
              </div>
            }

            @if (readOnly) {
              <p class="remote-empty remote-relay-readonly">{{ 'remote.relayReadOnly' | t }}</p>
            } @else if (confirmingDisconnect()) {
              <div class="remote-confirm" role="alert">
                <p>{{ 'remote.relayDisconnectConfirm' | t }}</p>
                <div class="remote-confirm-actions">
                  <button
                    type="button"
                    class="secondary"
                    [disabled]="disconnecting()"
                    (click)="confirmingDisconnect.set(false)"
                  >
                    {{ 'common.cancel' | t }}
                  </button>
                  <button
                    type="button"
                    class="danger"
                    [disabled]="disconnecting()"
                    (click)="disconnectRelay()"
                  >
                    {{
                      (disconnecting()
                        ? 'remote.relayDisconnecting'
                        : 'remote.relayDisconnectAction'
                      ) | t
                    }}
                  </button>
                </div>
              </div>
            } @else {
              <button
                type="button"
                class="danger remote-relay-disconnect"
                [disabled]="busy()"
                (click)="confirmingDisconnect.set(true)"
              >
                <app-icon name="link" [size]="13" />{{ 'remote.relayDisconnect' | t }}
              </button>
            }
          }
        </section>

        <section class="network-section">
          <h3>{{ 'remote.addressSection' | t }}</h3>

          @if (linkOptions().length === 0 || !status()?.token) {
            <p class="remote-empty">{{ addressEmptyHint() | t }}</p>
          } @else {
            <!--
              Picking the address and reading the link it produces are one step, so they share the
              column beside the QR code rather than leaving it standing next to empty space.
            -->
            <div class="remote-link">
              <div class="remote-link-value">
                @if (linkOptions().length > 1) {
                  <label class="remote-address-pick">
                    <span>{{ 'remote.addressPick' | t }}</span>
                    <select [ngModel]="linkAddress()" (ngModelChange)="linkAddress.set($event)">
                      @for (option of linkOptions(); track option.value) {
                        <option [value]="option.value">{{ option.label }}</option>
                      }
                    </select>
                  </label>
                }
                <div class="remote-link-row">
                  <code>{{ accessUrl() }}</code>
                  <button type="button" class="secondary" (click)="copy('url', accessUrl())">
                    {{ (copiedTarget() === 'url' ? 'remote.copied' : 'remote.copyLink') | t }}
                  </button>
                </div>
              </div>
              @if (qrCode(); as image) {
                <figure class="remote-qr">
                  <svg
                    role="img"
                    [attr.viewBox]="'0 0 ' + image.size + ' ' + image.size"
                    [attr.aria-label]="'remote.qrAlt' | t"
                  >
                    <rect width="100%" height="100%" fill="#ffffff" />
                    <path [attr.d]="image.path" fill="#000000" />
                  </svg>
                  <figcaption>{{ 'remote.qrHint' | t }}</figcaption>
                </figure>
              }
            </div>
          }
        </section>

        <section class="network-section">
          <h3>{{ 'remote.tokenSection' | t }}</h3>

          @if (!status()?.token) {
            <p class="remote-empty">{{ 'remote.tokenMissing' | t }}</p>
          } @else {
            <div class="remote-token">
              <code>{{ shownToken() }}</code>
              <button type="button" class="secondary" (click)="tokenVisible.set(!tokenVisible())">
                {{ (tokenVisible() ? 'remote.tokenHide' : 'remote.tokenShow') | t }}
              </button>
              <button
                type="button"
                class="secondary"
                (click)="copy('token', status()?.token ?? '')"
              >
                {{ (copiedTarget() === 'token' ? 'remote.copied' : 'remote.tokenCopy') | t }}
              </button>
            </div>
          }

          @if (!readOnly) {
            @if (confirmingRegenerate()) {
              <div class="remote-confirm" role="alert">
                <p>{{ 'remote.tokenRegenerateConfirm' | t }}</p>
                <div class="remote-confirm-actions">
                  <button
                    type="button"
                    class="secondary"
                    [disabled]="regenerating()"
                    (click)="confirmingRegenerate.set(false)"
                  >
                    {{ 'common.cancel' | t }}
                  </button>
                  <button
                    type="button"
                    class="danger"
                    [disabled]="regenerating()"
                    (click)="regenerateToken()"
                  >
                    {{
                      (regenerating() ? 'remote.regenerating' : 'remote.tokenRegenerateAction') | t
                    }}
                  </button>
                </div>
              </div>
            } @else {
              <button
                type="button"
                class="danger remote-regenerate"
                [disabled]="busy()"
                (click)="confirmingRegenerate.set(true)"
              >
                <app-icon name="refresh" [size]="13" />{{ 'remote.tokenRegenerate' | t }}
              </button>
            }
          }
        </section>

        <div class="remote-notes-grid">
          <section class="network-section">
            <h3>{{ 'remote.securitySection' | t }}</h3>
            <ul class="remote-notes">
              <li>{{ 'remote.securityTrusted' | t }}</li>
              <li>{{ 'remote.securityToken' | t }}</li>
              <li>{{ 'remote.securityCertificate' | t }}</li>
              <li>{{ 'remote.securityRelay' | t }}</li>
            </ul>
          </section>

          <section class="network-section">
            <h3>{{ 'remote.limitSection' | t }}</h3>
            <ul class="remote-notes">
              <li>{{ 'remote.limitSize' | t }}</li>
              <li>{{ 'remote.limitTodo' | t }}</li>
              <li>{{ 'remote.limitRemote' | t }}</li>
            </ul>
          </section>
        </div>
      }
    </div>
  `,
  styleUrls: ['./agent-dialog.scss', './remote-access-panel.scss'],
})
export class RemoteAccessPanelComponent implements OnDestroy {
  private readonly remoteAccess = inject(RemoteAccessService);
  private readonly i18n = inject(I18nService);

  /** The backend refuses these commands from a remote client, so the panel only reports. */
  protected readonly readOnly = runtimeMode() === 'remote';
  protected readonly minPort = MIN_PORT;
  protected readonly maxPort = MAX_PORT;
  protected readonly unknownValue = UNKNOWN_VALUE;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly regenerating = signal(false);
  protected readonly enrolling = signal(false);
  protected readonly disconnecting = signal(false);
  protected readonly loadError = signal('');
  protected readonly actionError = signal('');
  protected readonly status = signal<RemoteAccessStatus | null>(null);
  protected readonly confirmingRegenerate = signal(false);
  protected readonly tokenVisible = signal(false);
  protected readonly copiedTarget = signal<CopyTarget | null>(null);

  protected readonly enabled = signal(false);
  protected readonly bindAddress = signal(ALL_INTERFACES);
  protected readonly port = signal<number | null>(DEFAULT_PORT);
  protected readonly tls = signal(true);
  /** Address the shown link and QR code point at; only offered when bound to every interface. */
  protected readonly linkAddress = signal('');
  protected readonly qrCode = signal<QrCodeImage | null>(null);

  /** Draft of the relay enrolment form; the password lives here for one request and no longer. */
  protected readonly relayUrl = signal('');
  protected readonly relayMethod = signal<RelayEnrollMethodName>('code');
  protected readonly relayCode = signal('');
  protected readonly relayUsername = signal('');
  protected readonly relayPassword = signal('');
  protected readonly relayDeviceName = signal('');
  protected readonly relayError = signal('');
  protected readonly confirmingDisconnect = signal(false);

  private copyTimer = 0;
  private relaySettleTimer = 0;
  private relaySettleDeadline: number | undefined;
  /** Drops QR results that arrive after the URL has already changed again. */
  private qrRequest = 0;

  protected readonly busy = computed(
    () => this.saving() || this.regenerating() || this.enrolling() || this.disconnecting(),
  );

  protected readonly portInvalid = computed(() => {
    const value = this.port();
    return value === null || !Number.isInteger(value) || value < MIN_PORT || value > MAX_PORT;
  });

  protected readonly dirty = computed(() => {
    const saved = this.status()?.settings;
    if (!saved) return false;
    return (
      saved.enabled !== this.enabled() ||
      saved.bindAddress !== this.bindAddress() ||
      saved.port !== this.port() ||
      saved.tls !== this.tls()
    );
  });

  protected readonly canSave = computed(
    () => !this.readOnly && !this.busy() && !this.portInvalid() && this.dirty(),
  );

  protected readonly serviceState = computed<ServiceState>(() => {
    const status = this.status();
    if (!status) return 'stopped';
    if (status.running) return 'running';
    // A stale error from an earlier attempt must not make a deliberately stopped service look broken.
    return status.settings.enabled && status.error ? 'failed' : 'stopped';
  });

  protected readonly serviceStateLabel = computed(() => {
    const state = this.serviceState();
    if (state === 'running') return this.i18n.t('remote.statusRunning');
    return this.i18n.t(state === 'failed' ? 'remote.statusFailed' : 'remote.statusStopped');
  });

  /** Every interface the user may bind to, plus whatever is already saved but no longer present. */
  protected readonly bindOptions = computed<AddressOption[]>(() => {
    const options: AddressOption[] = [
      { value: ALL_INTERFACES, label: this.i18n.t('remote.bindAll') },
    ];
    for (const address of this.lanAddresses()) {
      options.push({ value: address.address, label: this.describeAddress(address) });
    }
    options.push({ value: LOOPBACK_ADDRESS, label: this.i18n.t('remote.bindLoopback') });
    const current = this.bindAddress();
    if (!options.some((option) => option.value === current)) {
      options.push({ value: current, label: current });
    }
    return options;
  });

  /**
   * Every address another device can actually reach, LAN and relay alike.
   *
   * They share one selector because from the phone's side they are the same thing — a link that
   * opens this workbench — and only one of them can be shown at a time anyway.
   */
  protected readonly linkOptions = computed<AddressOption[]>(() => {
    const status = this.status();
    if (!status) return [];
    return [...this.lanLinkOptions(status), ...this.relayLinkOptions(status)];
  });

  protected readonly accessUrl = computed(() => {
    const status = this.status();
    if (!status?.token) return '';
    const options = this.linkOptions();
    if (options.length === 0) return '';
    const selected = options.find((option) => option.value === this.linkAddress()) ?? options[0];
    return selected.relay
      ? this.remoteAccess.buildRelayUrl(selected.relay, status.token)
      : this.remoteAccess.buildUrl(
          selected.value,
          status.settings.port,
          status.settings.tls,
          status.token,
        );
  });

  /** Why the address list is empty, so the panel names the missing step instead of the symptom. */
  protected readonly addressEmptyHint = computed(() => {
    const status = this.status();
    if (!status) return 'remote.enableFirst';
    const relayConnected = status.relay.state === 'connected';
    if (!status.running && !relayConnected) return 'remote.enableFirst';
    if (!status.token) return 'remote.tokenMissing';
    if (relayConnected && !status.running) return 'remote.relayNoAddress';
    return 'remote.noLanAddress';
  });

  protected readonly relayLink = computed(() => this.status()?.relay ?? null);

  protected readonly relayState = computed<RelayLinkState>(
    () => this.status()?.relay.state ?? 'disabled',
  );

  protected readonly relayStateLabel = computed(() =>
    this.i18n.t(RELAY_STATE_LABEL_KEYS[this.relayState()]),
  );

  protected readonly relayConnectedSince = computed(() => {
    const since = this.status()?.relay.connectedSince;
    if (!since) return '';
    return this.i18n.t('remote.relayConnectedSince', {
      since: formatRelativeTime(since, this.i18n.locale()),
    });
  });

  protected readonly relayUrlInvalid = computed(() => {
    const value = this.relayUrl().trim();
    // An empty field is unfinished, not wrong; the join button is what reports that.
    return value.length > 0 && !RELAY_URL_PATTERN.test(value);
  });

  protected readonly canEnrollRelay = computed(() => {
    if (this.readOnly || this.busy()) return false;
    if (!this.relayUrl().trim() || this.relayUrlInvalid()) return false;
    if (!this.relayDeviceName().trim()) return false;
    return this.relayMethod() === 'code'
      ? this.relayCode().trim().length > 0
      : this.relayUsername().trim().length > 0 && this.relayPassword().length > 0;
  });

  protected readonly shownToken = computed(() => {
    const token = this.status()?.token ?? '';
    if (!token) return '';
    return this.tokenVisible() ? token : '•'.repeat(Math.min(token.length, MASK_LENGTH));
  });

  private readonly lanAddresses = computed<RemoteAccessAddress[]>(
    () => this.status()?.addresses.filter((address) => !address.loopback) ?? [],
  );

  constructor() {
    void this.reload();
    // The QR code is rendered by the backend, so it must be re-requested whenever the link moves.
    effect(() => {
      const url = this.accessUrl();
      const request = ++this.qrRequest;
      if (!url) {
        this.qrCode.set(null);
        return;
      }
      void this.remoteAccess
        .renderQr(url)
        .then((image) => {
          if (request === this.qrRequest) this.qrCode.set(image);
        })
        .catch(() => {
          if (request === this.qrRequest) this.qrCode.set(null);
        });
    });
  }

  ngOnDestroy(): void {
    window.clearTimeout(this.copyTimer);
    window.clearTimeout(this.relaySettleTimer);
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      this.applyStatus(await this.remoteAccess.getStatus());
    } catch (error) {
      this.loadError.set(this.describeError(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async save(): Promise<void> {
    const current = this.status();
    if (!this.canSave() || !current) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      this.applyStatus(
        await this.remoteAccess.updateSettings({
          enabled: this.enabled(),
          bindAddress: this.bindAddress(),
          port: this.port() ?? DEFAULT_PORT,
          tls: this.tls(),
          // The relay link is owned by the join and disconnect commands, so it travels back
          // untouched rather than being overwritten by whatever this form happens to hold.
          relay: current.settings.relay,
        }),
      );
    } catch (error) {
      this.actionError.set(this.i18n.t('remote.saveFailed', { error: this.describeError(error) }));
    } finally {
      this.saving.set(false);
    }
  }

  protected async enrollRelay(): Promise<void> {
    if (!this.canEnrollRelay()) return;
    this.enrolling.set(true);
    this.relayError.set('');
    const name = this.relayDeviceName().trim();
    try {
      this.applyStatus(
        await this.remoteAccess.enrollRelayDevice({
          url: this.relayUrl().trim(),
          method: this.buildEnrollMethod(name),
          name,
        }),
      );
      // Both are single-use secrets: keeping them in the form would only leave them on screen.
      this.relayCode.set('');
      this.relayPassword.set('');
    } catch (error) {
      this.relayError.set(
        this.i18n.t('remote.relayEnrollFailed', { error: this.describeError(error) }),
      );
    } finally {
      this.enrolling.set(false);
    }
  }

  protected async disconnectRelay(): Promise<void> {
    this.disconnecting.set(true);
    this.relayError.set('');
    try {
      this.applyStatus(await this.remoteAccess.disconnectRelay());
      this.confirmingDisconnect.set(false);
    } catch (error) {
      this.relayError.set(
        this.i18n.t('remote.relayDisconnectFailed', { error: this.describeError(error) }),
      );
    } finally {
      this.disconnecting.set(false);
    }
  }

  private buildEnrollMethod(name: string): RelayEnrollMethod {
    if (this.relayMethod() === 'code') {
      return { method: 'code', code: this.relayCode().trim(), name };
    }
    return {
      method: 'password',
      username: this.relayUsername().trim(),
      password: this.relayPassword(),
      name,
    };
  }

  protected async regenerateToken(): Promise<void> {
    this.regenerating.set(true);
    this.actionError.set('');
    try {
      this.applyStatus(await this.remoteAccess.regenerateToken());
      this.confirmingRegenerate.set(false);
      this.tokenVisible.set(false);
    } catch (error) {
      this.actionError.set(
        this.i18n.t('remote.tokenRegenerateFailed', { error: this.describeError(error) }),
      );
    } finally {
      this.regenerating.set(false);
    }
  }

  protected async copy(target: CopyTarget, value: string): Promise<void> {
    if (!value) return;
    // A LAN page served over plain HTTP has no clipboard API, so the text has to be copied by hand.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      this.actionError.set(this.i18n.t('remote.copyUnavailable'));
      return;
    }
    try {
      await clipboard.writeText(value);
    } catch {
      this.actionError.set(this.i18n.t('remote.copyUnavailable'));
      return;
    }
    this.copiedTarget.set(target);
    window.clearTimeout(this.copyTimer);
    this.copyTimer = window.setTimeout(() => this.copiedTarget.set(null), COPY_FEEDBACK_MS);
  }

  /** Resets the draft to whatever the backend now holds, so the form never drifts from the server. */
  private applyStatus(status: RemoteAccessStatus): void {
    this.status.set(status);
    this.enabled.set(status.settings.enabled);
    this.bindAddress.set(status.settings.bindAddress);
    this.port.set(status.settings.port);
    this.tls.set(status.settings.tls);
    // Seeding rather than overwriting: a relay the backend already knows saves retyping, but a
    // half-filled form must survive a status that arrives while the user is still typing.
    if (!this.relayUrl()) {
      this.relayUrl.set(status.settings.relay.url);
    }
    if (!this.relayDeviceName()) {
      this.relayDeviceName.set(status.relay.deviceName ?? '');
    }
    const reachable = this.linkOptions();
    if (!reachable.some((option) => option.value === this.linkAddress())) {
      this.linkAddress.set(reachable[0]?.value ?? '');
    }
    this.followRelayUntilSettled(status);
  }

  /**
   * Polls while the link is still connecting.
   *
   * Joining returns as soon as the tunnel task is started, so the status it hands back says
   * "connecting"; nothing pushes the moment it turns into connected or error, and a spinner that
   * never resolves would hide both outcomes. The deadline keeps a relay that never answers from
   * being polled for as long as the dialog stays open.
   */
  private followRelayUntilSettled(status: RemoteAccessStatus): void {
    window.clearTimeout(this.relaySettleTimer);
    if (status.relay.state !== 'connecting') {
      this.relaySettleDeadline = undefined;
      return;
    }
    this.relaySettleDeadline ??= Date.now() + RELAY_SETTLE_TIMEOUT_MS;
    if (Date.now() >= this.relaySettleDeadline) return;
    this.relaySettleTimer = window.setTimeout(() => {
      void this.remoteAccess
        .getStatus()
        .then((next) => this.applyStatus(next))
        .catch(() => {
          // A failed poll simply ends the follow-up; the next user action reloads and reports.
        });
    }, RELAY_SETTLE_POLL_MS);
  }

  /** Reachable LAN addresses, derived from what the server is actually bound to right now. */
  private lanLinkOptions(status: RemoteAccessStatus): AddressOption[] {
    if (!status.running) return [];
    const bound = status.settings.bindAddress;
    if (bound !== ALL_INTERFACES) {
      const match = status.addresses.find((address) => address.address === bound);
      return [{ value: bound, label: match ? this.describeAddress(match) : bound }];
    }
    return this.lanAddresses().map((address) => ({
      value: address.address,
      label: this.describeAddress(address),
    }));
  }

  private relayLinkOptions(status: RemoteAccessStatus): AddressOption[] {
    if (status.relay.state !== 'connected') return [];
    return status.relay.addresses.map((address) => ({
      value: address.url,
      label: this.describeRelayAddress(address),
      relay: address,
    }));
  }

  private describeAddress(address: RemoteAccessAddress): string {
    return address.interfaceName
      ? `${address.address} · ${address.interfaceName}`
      : address.address;
  }

  /** An address more than one hop out is named by the relay it is reached through. */
  private describeRelayAddress(address: RelayAddress): string {
    const name =
      address.hops > 0
        ? this.i18n.t('remote.relayVia', { name: address.relayName })
        : address.relayName;
    return `${name} · ${address.url}`;
  }

  private describeError(error: unknown): string {
    return typeof error === 'string' ? error : ((error as Error)?.message ?? String(error));
  }
}
