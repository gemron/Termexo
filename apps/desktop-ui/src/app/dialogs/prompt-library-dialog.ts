import { DatePipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { promptAssetMatches, type PromptAsset } from '../core/models/prompt-assets';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';

type AssetFilter = 'all' | 'draft' | 'history' | 'favorite' | 'pinned';

@Component({
  selector: 'app-prompt-library-dialog',
  imports: [DatePipe, FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="prompt-library modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-library-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-heading">
            <span><app-icon name="history" [size]="17" /></span>
            <div>
              <h2 id="prompt-library-title">{{ 'prompt.title' | t }}</h2>
              <p>{{ 'prompt.subtitle' | t: { count: assets().length } }}</p>
            </div>
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

        <div class="library-toolbar">
          <label class="input input-bordered input-sm">
            <app-icon name="search" [size]="14" />
            <input
              type="search"
              [placeholder]="'prompt.search' | t"
              [ngModel]="query()"
              (ngModelChange)="query.set($event)"
            />
            @if (query()) {
              <button type="button" (click)="query.set('')">
                <app-icon name="x" [size]="11" />
              </button>
            }
          </label>
          <nav role="tablist" [attr.aria-label]="'prompt.filter' | t">
            @for (item of filters; track item) {
              <button
                type="button"
                role="tab"
                [class.active]="filter() === item"
                [attr.aria-selected]="filter() === item"
                (click)="filter.set(item)"
              >
                {{ filterLabel(item) | t }}
              </button>
            }
          </nav>
        </div>

        @if (filteredAssets().length) {
          <div class="asset-list">
            @for (asset of filteredAssets(); track asset.id) {
              <article [class.is-draft]="asset.kind === 'draft'">
                <button
                  type="button"
                  class="asset-content"
                  [disabled]="!canUse()"
                  [title]="canUse() ? ('prompt.useHint' | t) : ('prompt.noAgent' | t)"
                  (click)="used.emit(asset)"
                >
                  <span class="asset-meta">
                    <b [attr.data-agent]="asset.agentType">{{ asset.agentType }}</b>
                    <strong>{{ asset.terminalName }}</strong>
                    <em>{{
                      asset.kind === 'draft' ? ('prompt.draft' | t) : ('prompt.history' | t)
                    }}</em>
                    @if (asset.redacted) {
                      <i>{{ 'prompt.redacted' | t }}</i>
                    }
                    <time>{{ asset.updatedAt | date: 'MM-dd HH:mm' }}</time>
                  </span>
                  <span class="asset-text">{{ asset.content }}</span>
                </button>
                <div class="asset-actions">
                  <button
                    type="button"
                    [class.active]="asset.pinned"
                    [title]="asset.pinned ? ('prompt.unpin' | t) : ('prompt.pin' | t)"
                    (click)="pinToggled.emit(asset)"
                  >
                    <app-icon name="link" [size]="13" />
                  </button>
                  <button
                    type="button"
                    [class.active]="asset.favorite"
                    [title]="asset.favorite ? ('prompt.unfavorite' | t) : ('prompt.favorite' | t)"
                    (click)="favoriteToggled.emit(asset)"
                  >
                    <app-icon name="star" [size]="13" />
                  </button>
                  <button
                    type="button"
                    class="delete"
                    [title]="'common.delete' | t"
                    (click)="deleted.emit(asset)"
                  >
                    <app-icon name="trash" [size]="13" />
                  </button>
                </div>
              </article>
            }
          </div>
        } @else {
          <div class="empty-library">
            <app-icon name="message" [size]="24" />
            <strong>{{ 'prompt.empty' | t }}</strong>
            <span>{{ 'prompt.emptyHelp' | t }}</span>
          </div>
        }

        <footer>
          <span>{{ 'prompt.storageNotice' | t }}</span>
          <button type="button" class="btn btn-sm" (click)="cancelled.emit()">
            {{ 'common.close' | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrls: ['./dialog.scss', './prompt-library-dialog.scss'],
})
export class PromptLibraryDialogComponent {
  readonly assets = input.required<PromptAsset[]>();
  readonly canUse = input(false);

  readonly used = output<PromptAsset>();
  readonly favoriteToggled = output<PromptAsset>();
  readonly pinToggled = output<PromptAsset>();
  readonly deleted = output<PromptAsset>();
  readonly cancelled = output<void>();

  protected readonly query = signal('');
  protected readonly filter = signal<AssetFilter>('all');
  protected readonly filters: readonly AssetFilter[] = [
    'all',
    'draft',
    'history',
    'favorite',
    'pinned',
  ];
  protected readonly filteredAssets = computed(() =>
    this.assets().filter((asset) => {
      const filter = this.filter();
      return (
        promptAssetMatches(asset, this.query()) &&
        (filter === 'all' ||
          asset.kind === filter ||
          (filter === 'favorite' && asset.favorite) ||
          (filter === 'pinned' && asset.pinned))
      );
    }),
  );

  protected filterLabel(filter: AssetFilter): string {
    return `prompt.filter.${filter}`;
  }
}
