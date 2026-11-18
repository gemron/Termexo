import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { registerRemoteHostsTranslations } from '../core/i18n/remote-hosts.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  parseRemoteAccessLink,
  ProbeOutcome,
  RemoteHost,
  RemoteHostHealth,
  RemoteHostStatus,
} from '../core/models/remote-host.models';
import { writeClipboardText } from '../core/services/clipboard-text';
import { RemoteHostsService } from '../core/services/remote-hosts.service';
import { IconComponent } from '../shared/icon/icon';
import { ModalFocusDirective } from '../shared/modal-focus.directive';

registerRemoteHostsTranslations();

const HOST_COLORS: readonly string[] = [
  '#38bdf8',
  '#22c55e',
  '#a855f7',
  '#f59e0b',
  '#f43f5e',
  '#14b8a6',
];

@Component({
  selector: 'app-remote-hosts-dialog',
  imports: [ModalFocusDirective, FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="dialog remote-hosts-dialog modal-box"
        appModal
        (dismissModal)="cancelled.emit()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-hosts-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="remote-hosts-title">{{ 'remoteHosts.title' | t }}</h2>
            <p>{{ 'remoteHosts.subtitle' | t }}</p>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            [title]="'common.close' | t"
            [attr.aria-label]="'common.close' | t"
            (click)="cancelled.emit()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="toolbar">
          <div class="search-box">
            <app-icon name="search" [size]="14" />
            <input
              type="text"
              data-testid="remote-hosts-search"
              [placeholder]="'remoteHosts.searchPlaceholder' | t"
              [ngModel]="searchQuery()"
              (ngModelChange)="searchQuery.set($event)"
            />
          </div>

          @if (groups().length > 0) {
            <select
              class="group-select"
              [ngModel]="selectedGroup()"
              (ngModelChange)="selectedGroup.set($event)"
            >
              <option value="">{{ 'remoteHosts.allGroups' | t }}</option>
              @for (group of groups(); track group) {
                <option [value]="group">{{ group }}</option>
              }
            </select>
          }

          <div class="toolbar-actions">
            <button
              type="button"
              class="secondary"
              data-testid="remote-hosts-refresh"
              [disabled]="remoteHosts.loading()"
              (click)="refreshAll()"
            >
              <app-icon name="refresh" [size]="13" />
              <span>{{ 'remoteHosts.refresh' | t }}</span>
            </button>
            <button
              type="button"
              class="primary"
              data-testid="remote-hosts-add"
              (click)="startCreate()"
            >
              <app-icon name="plus" [size]="14" />
              <span>{{ 'remoteHosts.add' | t }}</span>
            </button>
          </div>
        </div>

        @if (bannerError(); as error) {
          <div class="dialog-banner" role="alert">{{ error }}</div>
        }
        @if (bannerNotice(); as notice) {
          <div class="dialog-banner notice">{{ notice }}</div>
        }

        @if (editorOpen()) {
          <form class="editor-panel" (ngSubmit)="saveEditor()">
            <h3>
              {{ (editingHostId() ? 'remoteHosts.editTitle' : 'remoteHosts.addTitle') | t }}
            </h3>

            <div class="editor-grid">
              <label class="full">
                <span>{{ 'remoteHosts.pasteLinkLabel' | t }}</span>
                <input
                  type="text"
                  data-testid="remote-host-paste-link"
                  autocomplete="off"
                  spellcheck="false"
                  [placeholder]="'remoteHosts.pasteLinkPlaceholder' | t"
                  [value]="pastedLink()"
                  (input)="onPasteLinkInput($any($event.target).value)"
                />
              </label>

              <label>
                <span>{{ 'remoteHosts.nameLabel' | t }}</span>
                <input
                  type="text"
                  name="hostName"
                  data-testid="remote-host-name"
                  required
                  [placeholder]="'remoteHosts.namePlaceholder' | t"
                  [value]="draftName()"
                  (input)="draftName.set($any($event.target).value)"
                />
              </label>

              <label>
                <span>{{ 'remoteHosts.groupLabel' | t }}</span>
                <input
                  type="text"
                  name="hostGroup"
                  [placeholder]="'remoteHosts.groupPlaceholder' | t"
                  [value]="draftGroup()"
                  (input)="draftGroup.set($any($event.target).value)"
                />
              </label>

              <label class="full">
                <span>{{ 'remoteHosts.urlLabel' | t }}</span>
                <input
                  type="text"
                  name="hostUrl"
                  data-testid="remote-host-url"
                  required
                  autocomplete="off"
                  spellcheck="false"
                  [placeholder]="'remoteHosts.urlPlaceholder' | t"
                  [value]="draftUrl()"
                  (input)="onUrlInput($any($event.target).value)"
                />
              </label>

              <label>
                <span>{{ 'remoteHosts.tokenLabel' | t }}</span>
                <input
                  type="password"
                  name="hostToken"
                  data-testid="remote-host-token"
                  autocomplete="new-password"
                  spellcheck="false"
                  [placeholder]="
                    (editingHostId()
                      ? 'remoteHosts.tokenPlaceholderKeep'
                      : 'remoteHosts.tokenPlaceholderNew') | t
                  "
                  [value]="draftToken()"
                  (input)="draftToken.set($any($event.target).value)"
                />
              </label>

              <label>
                <span>{{ 'remoteHosts.colorLabel' | t }}</span>
                <div class="color-swatches">
                  @for (swatch of colors; track swatch) {
                    <button
                      type="button"
                      [style.background]="swatch"
                      [class.selected]="draftColor() === swatch"
                      (click)="draftColor.set(swatch)"
                    ></button>
                  }
                </div>
              </label>
            </div>

            <small class="field-hint">{{ 'remoteHosts.tokenHint' | t }}</small>

            @if (probeResult(); as result) {
              <div
                class="probe-box"
                [class.ok]="result.health === 'online'"
                [class.fail]="result.health !== 'online'"
              >
                {{ formatProbeOutcome(result) }}
              </div>
            }

            <div class="editor-actions">
              <button
                type="button"
                class="secondary"
                data-testid="remote-host-test"
                [disabled]="probingEditor() || !draftUrl().trim()"
                (click)="testDraftConnection()"
              >
                <app-icon name="activity" [size]="13" />
                <span>
                  {{ (probingEditor() ? 'remoteHosts.testing' : 'remoteHosts.testConnection') | t }}
                </span>
              </button>

              <div class="right">
                <button type="button" class="secondary" (click)="closeEditor()">
                  {{ 'common.cancel' | t }}
                </button>
                <button
                  type="submit"
                  class="primary"
                  data-testid="remote-host-save"
                  [disabled]="savingEditor() || !canSaveDraft()"
                >
                  <app-icon name="check" [size]="13" />
                  <span>{{ 'remoteHosts.save' | t }}</span>
                </button>
              </div>
            </div>
          </form>
        }

        <div class="host-scroll">
          @if (filteredHosts().length === 0) {
            <div class="empty-state" data-testid="remote-hosts-empty">
              <app-icon name="devices" [size]="24" />
              <h3>{{ 'remoteHosts.emptyTitle' | t }}</h3>
              <p>{{ 'remoteHosts.emptyHint' | t }}</p>
              @if (!editorOpen()) {
                <button type="button" class="primary" (click)="startCreate()">
                  <app-icon name="plus" [size]="14" />
                  <span>{{ 'remoteHosts.add' | t }}</span>
                </button>
              }
            </div>
          } @else {
            @for (host of filteredHosts(); track host.id) {
              @let status = statusFor(host.id);
              <article class="host-card" [class.open]="status?.open" data-testid="remote-host-card">
                <i
                  class="host-accent"
                  [style.background]="host.color || 'var(--border-strong)'"
                ></i>

                <div class="host-main">
                  <div class="host-title-row">
                    <strong>{{ host.name }}</strong>
                    <span
                      class="badge-pill"
                      [class.online]="status?.health === 'online'"
                      [class.warn]="status?.health === 'probing'"
                      [class.danger-pill]="isErrorHealth(status?.health)"
                    >
                      <i class="status-dot"></i>
                      {{ healthLabel(status?.health) }}
                    </span>
                    <span class="badge-pill">
                      {{ (host.kind === 'relay' ? 'remoteHosts.kindRelay' : 'remoteHosts.kindLan') | t }}
                    </span>
                    @if (host.readOnly) {
                      <span class="badge-pill">{{ 'remoteHosts.readOnly' | t }}</span>
                    }
                    @if (host.group) {
                      <span class="badge-pill group-pill">{{ host.group }}</span>
                    }
                  </div>

                  <div class="host-meta-row">
                    <code [title]="host.url">{{ host.url }}</code>
                    @if (status?.version; as version) {
                      <span>v{{ version }}</span>
                    }
                    @if (status?.latencyMs !== null && status?.latencyMs !== undefined) {
                      <span>{{ status?.latencyMs }} ms</span>
                    }
                  </div>

                  @if (status?.error; as err) {
                    <p class="host-error">{{ err }}</p>
                  }
                </div>

                <div class="host-actions">
                  <button
                    type="button"
                    class="primary"
                    data-testid="remote-host-open"
                    [disabled]="openingHostId() === host.id"
                    (click)="openHost(host)"
                  >
                    <app-icon name="external" [size]="13" />
                    <span>
                      {{ (status?.open ? 'remoteHosts.focus' : 'remoteHosts.open') | t }}
                    </span>
                  </button>

                  @if (status?.open) {
                    <button
                      type="button"
                      class="secondary icon-btn"
                      [title]="'remoteHosts.closeWindow' | t"
                      (click)="closeHostWindow(host)"
                    >
                      <app-icon name="square" [size]="12" />
                    </button>
                  }

                  <button
                    type="button"
                    class="secondary icon-btn"
                    [title]="'remoteHosts.probe' | t"
                    (click)="probeSingle(host)"
                  >
                    <app-icon name="refresh" [size]="13" />
                  </button>

                  <button
                    type="button"
                    class="secondary icon-btn"
                    [title]="'remoteHosts.copyUrl' | t"
                    (click)="copyHostUrl(host)"
                  >
                    <app-icon name="copy" [size]="13" />
                  </button>

                  <button
                    type="button"
                    class="secondary icon-btn"
                    data-testid="remote-host-edit"
                    [title]="'remoteHosts.edit' | t"
                    (click)="startEdit(host)"
                  >
                    <app-icon name="edit" [size]="13" />
                  </button>

                  <button
                    type="button"
                    class="secondary icon-btn"
                    data-testid="remote-host-delete"
                    [title]="'remoteHosts.delete' | t"
                    (click)="deleteHost(host)"
                  >
                    <app-icon name="trash" [size]="13" />
                  </button>
                </div>
              </article>
            }
          }
        </div>

        <div class="dialog-footer">
          <span>
            {{
              'remoteHosts.summary'
                | t
                  : {
                      total: remoteHosts.hosts().length,
                      online: remoteHosts.onlineCount(),
                      open: remoteHosts.openCount(),
                    }
            }}
          </span>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            {{ 'common.close' | t }}
          </button>
        </div>
      </section>
    </div>
  `,
  styleUrl: './remote-hosts-dialog.scss',
})
export class RemoteHostsDialogComponent {
  protected readonly remoteHosts = inject(RemoteHostsService);
  private readonly i18n = inject(I18nService);

  readonly cancelled = output<void>();

  protected readonly colors = HOST_COLORS;
  protected readonly searchQuery = signal('');
  protected readonly selectedGroup = signal('');
  protected readonly bannerError = signal<string | null>(null);
  protected readonly bannerNotice = signal<string | null>(null);
  protected readonly openingHostId = signal<string | null>(null);

  protected readonly editorOpen = signal(false);
  protected readonly editingHostId = signal<string | null>(null);
  protected readonly pastedLink = signal('');
  protected readonly draftName = signal('');
  protected readonly draftUrl = signal('');
  protected readonly draftToken = signal('');
  protected readonly draftGroup = signal('');
  protected readonly draftColor = signal<string>(HOST_COLORS[0]);
  protected readonly probingEditor = signal(false);
  protected readonly savingEditor = signal(false);
  protected readonly probeResult = signal<ProbeOutcome | null>(null);

  protected readonly groups = computed(() => {
    const set = new Set<string>();
    for (const host of this.remoteHosts.hosts()) {
      if (host.group) {
        set.add(host.group);
      }
    }
    return [...set].sort();
  });

  protected readonly filteredHosts = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const group = this.selectedGroup();
    return this.remoteHosts.hosts().filter((host) => {
      if (group && host.group !== group) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        host.name.toLowerCase().includes(query) ||
        host.url.toLowerCase().includes(query) ||
        (host.group?.toLowerCase().includes(query) ?? false)
      );
    });
  });

  constructor() {
    void this.remoteHosts.ensureLoaded().then(() => {
      if (this.remoteHosts.hosts().length > 0) {
        void this.remoteHosts.refreshAll();
      }
    });
  }

  protected statusFor(hostId: string): RemoteHostStatus | undefined {
    return this.remoteHosts.statusMap().get(hostId);
  }

  protected isErrorHealth(health: RemoteHostHealth | undefined): boolean {
    return (
      health === 'unauthorized' ||
      health === 'untrusted-certificate' ||
      health === 'incompatible'
    );
  }

  protected healthLabel(health: RemoteHostHealth | undefined): string {
    switch (health) {
      case 'online':
        return this.i18n.t('remoteHosts.statusOnline');
      case 'offline':
        return this.i18n.t('remoteHosts.statusOffline');
      case 'probing':
        return this.i18n.t('remoteHosts.statusProbing');
      case 'unauthorized':
        return this.i18n.t('remoteHosts.statusUnauthorized');
      case 'untrusted-certificate':
        return this.i18n.t('remoteHosts.statusUntrustedCert');
      case 'incompatible':
        return this.i18n.t('remoteHosts.statusIncompatible');
      default:
        return this.i18n.t('remoteHosts.statusUnknown');
    }
  }

  protected canSaveDraft(): boolean {
    const hasName = this.draftName().trim().length > 0;
    const hasUrl = this.draftUrl().trim().length > 0;
    const hasToken = this.editingHostId() !== null || this.draftToken().trim().length > 0;
    return hasName && hasUrl && hasToken;
  }

  protected startCreate(): void {
    this.bannerError.set(null);
    this.bannerNotice.set(null);
    this.editingHostId.set(null);
    this.pastedLink.set('');
    this.draftName.set('');
    this.draftUrl.set('');
    this.draftToken.set('');
    this.draftGroup.set('');
    this.draftColor.set(HOST_COLORS[this.remoteHosts.hosts().length % HOST_COLORS.length]);
    this.probeResult.set(null);
    this.editorOpen.set(true);
  }

  protected startEdit(host: RemoteHost): void {
    this.bannerError.set(null);
    this.bannerNotice.set(null);
    this.editingHostId.set(host.id);
    this.pastedLink.set('');
    this.draftName.set(host.name);
    this.draftUrl.set(host.url);
    this.draftToken.set('');
    this.draftGroup.set(host.group ?? '');
    this.draftColor.set(host.color ?? HOST_COLORS[0]);
    this.probeResult.set(null);
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    this.editorOpen.set(false);
    this.draftToken.set('');
    this.pastedLink.set('');
    this.probeResult.set(null);
  }

  protected onPasteLinkInput(value: string): void {
    this.pastedLink.set(value);
    const parsed = parseRemoteAccessLink(value);
    if (!parsed) {
      return;
    }
    this.draftUrl.set(parsed.url);
    if (parsed.token) {
      this.draftToken.set(parsed.token);
      this.pastedLink.set('');
      this.bannerNotice.set(this.i18n.t('remoteHosts.pasteLinkApplied'));
    }
    if (!this.draftName().trim()) {
      this.draftName.set(parsed.suggestedName);
    }
  }

  protected onUrlInput(value: string): void {
    const parsed = parseRemoteAccessLink(value);
    if (parsed && parsed.token) {
      this.draftUrl.set(parsed.url);
      this.draftToken.set(parsed.token);
      if (!this.draftName().trim()) {
        this.draftName.set(parsed.suggestedName);
      }
      this.bannerNotice.set(this.i18n.t('remoteHosts.pasteLinkApplied'));
      return;
    }
    this.draftUrl.set(value);
  }

  protected async testDraftConnection(): Promise<void> {
    this.probingEditor.set(true);
    this.probeResult.set(null);
    this.bannerError.set(null);
    try {
      const hasToken =
        this.draftToken().trim().length > 0 || this.editingHostId() !== null;
      const result = await this.remoteHosts.probeHost({
        hostId: this.editingHostId(),
        url: this.draftUrl().trim(),
        token: this.draftToken().trim() || null,
        verifyToken: hasToken,
      });
      this.probeResult.set(result);
    } catch (error) {
      this.bannerError.set(String(error));
    } finally {
      this.probingEditor.set(false);
    }
  }

  protected formatProbeOutcome(outcome: ProbeOutcome): string {
    if (outcome.health === 'online') {
      const key = outcome.readOnly
        ? 'remoteHosts.probeValidReadOnly'
        : 'remoteHosts.probeValidToken';
      return this.i18n.t(key, {
        version: outcome.version ?? '?',
        latency: outcome.latencyMs ?? 0,
      });
    }
    return outcome.error ?? this.healthLabel(outcome.health);
  }

  protected async saveEditor(): Promise<void> {
    if (!this.canSaveDraft()) {
      return;
    }
    this.savingEditor.set(true);
    this.bannerError.set(null);
    try {
      await this.remoteHosts.saveHost({
        id: this.editingHostId(),
        name: this.draftName().trim(),
        url: this.draftUrl().trim(),
        token: this.draftToken().trim() || null,
        group: this.draftGroup().trim() || null,
        color: this.draftColor(),
      });
      this.closeEditor();
    } catch (error) {
      this.bannerError.set(String(error));
    } finally {
      this.savingEditor.set(false);
    }
  }

  protected async refreshAll(): Promise<void> {
    this.bannerError.set(null);
    try {
      await this.remoteHosts.refreshAll();
    } catch (error) {
      this.bannerError.set(String(error));
    }
  }

  protected async probeSingle(host: RemoteHost): Promise<void> {
    this.bannerError.set(null);
    try {
      await this.remoteHosts.probeHost({
        hostId: host.id,
        verifyToken: true,
      });
    } catch (error) {
      this.bannerError.set(String(error));
    }
  }

  protected async openHost(host: RemoteHost): Promise<void> {
    this.openingHostId.set(host.id);
    this.bannerError.set(null);
    try {
      await this.remoteHosts.openHost(host.id);
    } catch (error) {
      this.bannerError.set(String(error));
    } finally {
      this.openingHostId.set(null);
    }
  }

  protected async closeHostWindow(host: RemoteHost): Promise<void> {
    this.bannerError.set(null);
    try {
      await this.remoteHosts.closeHost(host.id);
    } catch (error) {
      this.bannerError.set(String(error));
    }
  }

  protected async copyHostUrl(host: RemoteHost): Promise<void> {
    try {
      await writeClipboardText(host.url);
      this.bannerNotice.set(this.i18n.t('remoteHosts.copiedUrl'));
    } catch (error) {
      this.bannerError.set(String(error));
    }
  }

  protected async deleteHost(host: RemoteHost): Promise<void> {
    this.bannerError.set(null);
    try {
      await this.remoteHosts.deleteHost(host.id);
      if (this.editingHostId() === host.id) {
        this.closeEditor();
      }
    } catch (error) {
      this.bannerError.set(String(error));
    }
  }
}
