import { Component, inject, signal } from '@angular/core';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { DirectoryPickerService } from '../core/services/directory-picker.service';
import { StorageLocationService, StorageOverview } from '../core/services/storage-location.service';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { IconComponent } from '../shared/icon/icon';

/** Byte sizes are shown in the largest unit that keeps the number readable. */
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/**
 * Shows where Termexo keeps its data, and moves it.
 *
 * The default directory is on the system drive, and the database is the largest thing Termexo
 * writes — one reached 208 MB of agent events before there was any way to see it. This panel is
 * where that becomes visible, and where the data can be put on another drive.
 */
@Component({
  selector: 'app-storage-panel',
  imports: [IconComponent, TranslatePipe],
  template: `
    @if (overview(); as storage) {
      <section class="profile-editor storage-panel">
        <header class="storage-location">
          <div>
            <strong>{{ 'storage.dataDirectory' | t }}</strong>
            <code [title]="storage.dataDirectory">{{ storage.dataDirectory }}</code>
            @if (storage.relocated) {
              <small>{{ 'storage.relocatedFrom' | t: { path: storage.defaultDirectory } }}</small>
            }
          </div>
          <div class="storage-location-actions">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              (click)="copy(storage.dataDirectory)"
            >
              {{ 'common.copy' | t }}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              (click)="reveal(storage.dataDirectory)"
            >
              <app-icon name="folder" [size]="14" />
              {{ 'storage.openFolder' | t }}
            </button>
          </div>
        </header>

        <ul class="storage-entries">
          @for (entry of storage.entries; track entry.path) {
            <li [class.missing]="entry.bytes === null">
              <span class="storage-entry-name">{{ entry.name }}</span>
              <span class="storage-entry-size">
                {{ entry.bytes === null ? ('storage.notCreated' | t) : formatSize(entry.bytes) }}
              </span>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
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

        <footer class="storage-actions">
          <div class="storage-executable">
            <small>{{ 'storage.executable' | t }}</small>
            <code [title]="storage.executable">{{ storage.executable }}</code>
            <small>v{{ storage.version }}</small>
          </div>
          <div class="storage-location-actions">
            @if (storage.relocated) {
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                [disabled]="busy()"
                (click)="resetToDefault()"
              >
                {{ 'storage.useDefault' | t }}
              </button>
            }
            <button
              type="button"
              class="btn btn-primary btn-sm"
              [disabled]="busy()"
              (click)="move()"
            >
              <app-icon name="folder" [size]="14" />
              {{ busy() ? ('storage.moving' | t) : ('storage.changeLocation' | t) }}
            </button>
          </div>
        </footer>

        @if (notice(); as text) {
          <p class="storage-notice alert">
            <app-icon name="shield" [size]="15" />
            <span>{{ text }}</span>
          </p>
        }
      </section>
    } @else {
      <section class="profile-editor">
        <p>{{ 'storage.desktopOnly' | t }}</p>
      </section>
    }
  `,
  styleUrl: './dialog.scss',
})
export class StoragePanelComponent {
  private readonly storage = inject(StorageLocationService);
  private readonly directories = inject(DirectoryPickerService);
  private readonly gateway = inject(TerminalGatewayService);
  private readonly i18n = inject(I18nService);

  protected readonly overview = signal<StorageOverview | null>(null);
  protected readonly busy = signal(false);
  /** What the last action left the user needing to know — a restart, or why nothing happened. */
  protected readonly notice = signal<string | null>(null);

  constructor() {
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
      await navigator.clipboard?.writeText(value);
    } catch {
      // A page served over plain HTTP has no clipboard; the path is on screen to copy by hand.
    }
  }

  protected async reveal(path: string): Promise<void> {
    try {
      await this.gateway.openPath(path);
    } catch (error) {
      this.notice.set(this.describe(error));
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
    this.busy.set(true);
    this.notice.set(null);
    try {
      const previous = await this.storage.relocate(target);
      await this.refresh();
      this.notice.set(this.i18n.t('storage.movedRestart', { path: previous }));
    } catch (error) {
      this.notice.set(this.describe(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async resetToDefault(): Promise<void> {
    this.busy.set(true);
    this.notice.set(null);
    try {
      await this.storage.resetToDefault();
      await this.refresh();
      this.notice.set(this.i18n.t('storage.restoredRestart'));
    } catch (error) {
      this.notice.set(this.describe(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.overview.set(await this.storage.overview());
    } catch (error) {
      this.notice.set(this.describe(error));
    }
  }

  private describe(error: unknown): string {
    return typeof error === 'string' ? error : String(error);
  }
}
