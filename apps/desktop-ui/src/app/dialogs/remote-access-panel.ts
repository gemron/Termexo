import { Component, computed, effect, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { registerRemoteTranslations } from '../core/i18n/remote.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import type {
  QrCodeImage,
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

type CopyTarget = 'url' | 'token';
type ServiceState = 'running' | 'stopped' | 'failed';

/** One option in the bind-address selector or in the link-address selector. */
interface AddressOption {
  value: string;
  label: string;
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

          <label class="checkbox-control remote-tls">
            <input
              type="checkbox"
              [disabled]="readOnly || busy()"
              [ngModel]="tls()"
              (ngModelChange)="tls.set($event)"
            />
            <span>{{ 'remote.https' | t }}</span>
          </label>
          <small class="field-hint">{{ 'remote.httpsHint' | t }}</small>

          <div class="remote-runtime">
            <span>{{
              'remote.connectedClients' | t: { count: status()?.connectedClients ?? 0 }
            }}</span>
          </div>

          @if (!readOnly) {
            <div class="editor-actions">
              @if (dirty()) {
                <small class="remote-dirty">{{ 'remote.unsaved' | t }}</small>
              }
              <span></span>
              <button type="button" class="primary" [disabled]="!canSave()" (click)="save()">
                {{ (saving() ? 'remote.saving' : 'remote.save') | t }}
              </button>
            </div>
          }
        </section>

        <section class="network-section">
          <h3>{{ 'remote.addressSection' | t }}</h3>

          @if (!status()?.running) {
            <p class="remote-empty">{{ 'remote.enableFirst' | t }}</p>
          } @else if (!status()?.token) {
            <p class="remote-empty">{{ 'remote.tokenMissing' | t }}</p>
          } @else if (linkOptions().length === 0) {
            <p class="remote-empty">{{ 'remote.noLanAddress' | t }}</p>
          } @else {
            @if (linkOptions().length > 1) {
              <label>
                <span>{{ 'remote.addressPick' | t }}</span>
                <select [ngModel]="linkAddress()" (ngModelChange)="linkAddress.set($event)">
                  @for (option of linkOptions(); track option.value) {
                    <option [value]="option.value">{{ option.label }}</option>
                  }
                </select>
              </label>
            }

            <div class="remote-link">
              <div class="remote-link-value">
                <code>{{ accessUrl() }}</code>
                <button type="button" class="secondary" (click)="copy('url', accessUrl())">
                  {{ (copiedTarget() === 'url' ? 'remote.copied' : 'remote.copyLink') | t }}
                </button>
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

        <section class="network-section">
          <h3>{{ 'remote.securitySection' | t }}</h3>
          <ul class="remote-notes">
            <li>{{ 'remote.securityTrusted' | t }}</li>
            <li>{{ 'remote.securityToken' | t }}</li>
            <li>{{ 'remote.securityCertificate' | t }}</li>
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

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly regenerating = signal(false);
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

  private copyTimer = 0;
  /** Drops QR results that arrive after the URL has already changed again. */
  private qrRequest = 0;

  protected readonly busy = computed(() => this.saving() || this.regenerating());

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

  /** Addresses another device can actually reach, derived from what the server is bound to now. */
  protected readonly linkOptions = computed<AddressOption[]>(() => {
    const status = this.status();
    if (!status) return [];
    const bound = status.settings.bindAddress;
    if (bound !== ALL_INTERFACES) {
      const match = status.addresses.find((address) => address.address === bound);
      return [{ value: bound, label: match ? this.describeAddress(match) : bound }];
    }
    return this.lanAddresses().map((address) => ({
      value: address.address,
      label: this.describeAddress(address),
    }));
  });

  protected readonly accessUrl = computed(() => {
    const status = this.status();
    if (!status?.running || !status.token) return '';
    const options = this.linkOptions();
    if (options.length === 0) return '';
    const selected = options.find((option) => option.value === this.linkAddress());
    const address = (selected ?? options[0]).value;
    return this.remoteAccess.buildUrl(
      address,
      status.settings.port,
      status.settings.tls,
      status.token,
    );
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
    if (!this.canSave()) return;
    this.saving.set(true);
    this.actionError.set('');
    try {
      this.applyStatus(
        await this.remoteAccess.updateSettings({
          enabled: this.enabled(),
          bindAddress: this.bindAddress(),
          port: this.port() ?? DEFAULT_PORT,
          tls: this.tls(),
        }),
      );
    } catch (error) {
      this.actionError.set(this.i18n.t('remote.saveFailed', { error: this.describeError(error) }));
    } finally {
      this.saving.set(false);
    }
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
    const reachable = this.linkOptions();
    if (!reachable.some((option) => option.value === this.linkAddress())) {
      this.linkAddress.set(reachable[0]?.value ?? '');
    }
  }

  private describeAddress(address: RemoteAccessAddress): string {
    return address.interfaceName
      ? `${address.address} · ${address.interfaceName}`
      : address.address;
  }

  private describeError(error: unknown): string {
    return typeof error === 'string' ? error : ((error as Error)?.message ?? String(error));
  }
}
