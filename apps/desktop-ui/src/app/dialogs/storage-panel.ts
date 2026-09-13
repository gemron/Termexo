import { Component, DestroyRef, inject, signal } from '@angular/core';

import { registerStorageTranslations } from '../core/i18n/storage.i18n';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { DirectoryPickerService } from '../core/services/directory-picker.service';
import { StorageLocationService, StorageOverview } from '../core/services/storage-location.service';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { IconComponent } from '../shared/icon/icon';

registerStorageTranslations();

/** Byte sizes are shown in the largest unit that keeps the number readable. */
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** How long the copy button says the path was copied before it reads "copy" again. */
const COPIED_FEEDBACK_MS = 2_000;

/** Whether the last action's message reports an outcome or a problem, which it is coloured by. */
type NoticeTone = 'success' | 'error';

interface StorageNotice {
  readonly text: string;
  readonly tone: NoticeTone;
}

/**
 * Shows where Termexo keeps its data, and moves it.
 *
 * The default directory is on the system drive, and the database is the largest thing Termexo
 * writes — one reached 208 MB of agent events before there was any way to see it. This panel is
 * where that becomes visible, and where the data can be put on another drive.
 *
 * The move actions sit in the data directory section they change. They used to share a footer with
 * the executable path, where "change location" read as moving the program itself.
 */
@Component({
  selector: 'app-storage-panel',
  imports: [IconComponent, TranslatePipe],
  template: `
    @if (overview(); as storage) {
      <section class="profile-editor">
        <div class="network-intro">
          <div>
            <strong>{{ 'storage.title' | t }}</strong>
            <span>{{ 'storage.subtitle' | t }}</span>
          </div>
          <span class="storage-total-chip">{{ formatSize(storage.totalBytes) }}</span>
        </div>

        <section class="network-section">
          <h3>{{ 'storage.dataDirectory' | t }}</h3>
          <div class="storage-path">
            <code [title]="storage.dataDirectory">{{ storage.dataDirectory }}</code>
            <button
              type="button"
              class="storage-icon-button"
              [title]="(copied() ? 'storage.copied' : 'storage.copyPath') | t"
              [attr.aria-label]="(copied() ? 'storage.copied' : 'storage.copyPath') | t"
              (click)="copy(storage.dataDirectory)"
            >
              <app-icon [name]="copied() ? 'check' : 'copy'" [size]="14" />
            </button>
            <button
              type="button"
              class="storage-icon-button"
              [title]="'storage.openFolder' | t"
              [attr.aria-label]="'storage.openFolder' | t"
              (click)="reveal(storage.dataDirectory)"
            >
              <app-icon name="folder" [size]="14" />
            </button>
          </div>
          @if (storage.relocated) {
            <small class="field-hint">
              {{ 'storage.relocatedFrom' | t: { path: storage.defaultDirectory } }}
            </small>
          }

          <div class="storage-move">
            <small class="field-hint">{{ 'storage.moveHint' | t }}</small>
            <div class="storage-move-actions">
              @if (storage.relocated) {
                <button
                  type="button"
                  class="secondary"
                  [disabled]="busy()"
                  (click)="resetToDefault()"
                >
                  {{ 'storage.useDefault' | t }}
                </button>
              }
              <button type="button" class="primary" [disabled]="busy()" (click)="move()">
                @if (busy()) {
                  <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                } @else {
                  <app-icon name="folder" [size]="14" />
                }
                {{ (busy() ? 'storage.moving' : 'storage.changeLocation') | t }}
              </button>
            </div>
          </div>

          @if (notice(); as message) {
            <p
              class="storage-notice"
              [class.error]="message.tone === 'error'"
              [attr.role]="message.tone === 'error' ? 'alert' : 'status'"
            >
              <app-icon
                [name]="message.tone === 'error' ? 'triangle-alert' : 'check'"
                [size]="14"
              />
              <span>{{ message.text }}</span>
            </p>
          }
        </section>

        <section class="network-section">
          <h3>{{ 'storage.usage' | t }}</h3>
          <ul class="storage-entries">
            @for (entry of storage.entries; track entry.path) {
              <li [class.missing]="entry.bytes === null">
                <span class="storage-entry-name">{{ entry.name }}</span>
                <span class="storage-entry-size">
                  {{ entry.bytes === null ? ('storage.notCreated' | t) : formatSize(entry.bytes) }}
                </span>
                <button
                  type="button"
                  class="storage-icon-button"
                  [disabled]="entry.bytes === null"
                  [title]="'storage.openFolder' | t"
                  [attr.aria-label]="'storage.openFolder' | t"
                  (click)="reveal(entry.path)"
                >
                  <app-icon name="folder" [size]="13" />
                </button>
              </li>
            }
            <li class="storage-total">
              <span class="storage-entry-name">{{ 'storage.total' | t }}</span>
              <span class="storage-entry-size">{{ formatSize(storage.totalBytes) }}</span>
            </li>
          </ul>
        </section>

        <section class="network-section">
          <h3>{{ 'storage.application' | t }}</h3>
          <dl class="storage-application">
            <div>
              <dt>{{ 'storage.executable' | t }}</dt>
              <dd>
                <code [title]="storage.executable">{{ storage.executable }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'storage.version' | t }}</dt>
              <dd>v{{ storage.version }}</dd>
            </div>
          </dl>
        </section>
      </section>
    } @else {
      <section class="profile-editor">
        <p class="field-hint">{{ 'storage.desktopOnly' | t }}</p>
      </section>
    }
  `,
  styleUrls: ['./agent-dialog.scss', './storage-panel.scss'],
})
export class StoragePanelComponent {
  private readonly storage = inject(StorageLocationService);
  private readonly directories = inject(DirectoryPickerService);
  private readonly gateway = inject(TerminalGatewayService);
  private readonly i18n = inject(I18nService);

  protected readonly overview = signal<StorageOverview | null>(null);
  protected readonly busy = signal(false);
  protected readonly copied = signal(false);
  /** What the last action left the user needing to know — a restart, or why nothing happened. */
  protected readonly notice = signal<StorageNotice | null>(null);
  private copiedTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.copiedTimer));
    void this.refresh();
  }

  protected formatSize(bytes: number): string {
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < SIZE_UNITS.length - 1) {
      size /= 1024;
      unit += 1;
    }
    // Bytes are whole; everything above reads better with one decimal.
    const rounded = unit === 0 ? size : Math.round(size * 10) / 10;
    return `${rounded} ${SIZE_UNITS[unit]}`;
  }

  protected async copy(value: string): Promise<void> {
    try {
      if (!navigator.clipboard) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(value);
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), COPIED_FEEDBACK_MS);
    } catch {
      // A page served over plain HTTP has no clipboard; the path stays on screen to copy by hand.
      this.showError(this.i18n.t('storage.copyFailed'));
    }
  }

  protected async reveal(path: string): Promise<void> {
    try {
      await this.gateway.openPath(path);
    } catch (error) {
      this.showError(this.describe(error));
    }
  }

  /**
   * Copies the data to a directory the user picks, and asks them to restart.
   *
   * The database and the hook spool are opened once at startup, so nothing here can hand the
   * running application a new location — only the next start reads it.
   */
  protected async move(): Promise<void> {
    const current = this.overview()?.dataDirectory ?? '';
    const target = await this.directories.select(current, this.i18n.t('storage.pickDirectory'));
    if (!target) {
      return;
    }
    await this.runLocationChange(async () => {
      const previous = await this.storage.relocate(target);
      return this.i18n.t('storage.movedRestart', { path: previous });
    });
  }

  protected async resetToDefault(): Promise<void> {
    await this.runLocationChange(async () => {
      await this.storage.resetToDefault();
      return this.i18n.t('storage.restoredRestart');
    });
  }

  /** Runs a move or a reset, keeping the buttons locked until it settles and reporting the result. */
  private async runLocationChange(change: () => Promise<string>): Promise<void> {
    this.busy.set(true);
    this.notice.set(null);
    try {
      const message = await change();
      await this.refresh();
      this.notice.set({ text: message, tone: 'success' });
    } catch (error) {
      this.showError(this.describe(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.overview.set(await this.storage.overview());
    } catch (error) {
      this.showError(this.describe(error));
    }
  }

  private showError(text: string): void {
    this.notice.set({ text, tone: 'error' });
  }

  private describe(error: unknown): string {
    return typeof error === 'string' ? error : String(error);
  }
}
