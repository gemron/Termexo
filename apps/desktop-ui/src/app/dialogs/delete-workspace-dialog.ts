import { Component, input, output } from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { Workspace } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-delete-workspace-dialog',
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-workspace-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="delete-workspace-dialog-title">{{ 'dialog.workspaceDeleteTitle' | t }}</h2>
            <p>{{ 'dialog.workspaceDeleteDescription' | t }}</p>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            [title]="'common.close' | t"
            [attr.aria-label]="'common.close' | t"
            [disabled]="deleting()"
            (click)="cancelled.emit()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="delete-workspace-summary alert alert-warning">
          <app-icon name="trash" [size]="18" />
          <div>
            <strong>{{ 'dialog.workspaceDeleteConfirm' | t: { name: workspace().name } }}</strong>
            <span>{{ workspace().projectPath }}</span>
          </div>
        </div>

        @if (workspace().terminals.length > 0) {
          <p class="delete-workspace-warning">
            {{ 'dialog.workspaceDeleteProcesses' | t: { count: workspace().terminals.length } }}
          </p>
        }

        <footer>
          <button
            type="button"
            class="secondary btn btn-ghost btn-sm"
            [disabled]="deleting()"
            (click)="cancelled.emit()"
          >
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            [disabled]="deleting()"
            (click)="confirmed.emit()"
          >
            <app-icon name="trash" [size]="14" />
            {{ deleting() ? ('dialog.deleting' | t) : ('dialog.workspaceDeleteTitle' | t) }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrls: ['./dialog.scss', './delete-workspace-dialog.scss'],
})
export class DeleteWorkspaceDialogComponent {
  readonly workspace = input.required<Workspace>();
  readonly deleting = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
