import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { Workspace } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-merge-workspace-dialog',
  imports: [FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancel()">
      <section
        class="dialog merge-workspace-dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-workspace-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="merge-workspace-dialog-title">{{ 'dialog.workspaceMergeTitle' | t }}</h2>
            <p>{{ 'dialog.workspaceMergeDescription' | t }}</p>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            [title]="'common.close' | t"
            [attr.aria-label]="'common.close' | t"
            [disabled]="merging()"
            (click)="cancel()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="merge-source">
          <span class="merge-workspace-icon"><app-icon name="folder" [size]="18" /></span>
          <span>
            <small>{{ 'dialog.sourceWorkspace' | t }}</small>
            <strong>{{ sourceWorkspace().name }}</strong>
            <code>{{ sourceWorkspace().projectPath }}</code>
          </span>
          <em>{{ 'dialog.terminalCount' | t: { count: sourceWorkspace().terminals.length } }}</em>
        </div>

        <div class="merge-direction" aria-hidden="true">
          <span></span>
          <app-icon name="merge" [size]="17" />
          <span></span>
        </div>

        <label class="merge-target-field">
          <span>{{ 'dialog.mergeInto' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="targetWorkspaceId()"
            (ngModelChange)="targetWorkspaceId.set($event)"
            [disabled]="merging() || targetWorkspaces().length === 0"
          >
            @for (workspace of targetWorkspaces(); track workspace.id) {
              <option [value]="workspace.id">
                {{ workspace.name }} ·
                {{ 'dialog.terminalCount' | t: { count: workspace.terminals.length } }}
              </option>
            }
          </select>
        </label>

        @if (selectedTargetWorkspace(); as targetWorkspace) {
          <div class="merge-preview">
            <app-icon name="merge" [size]="16" />
            <span>
              {{
                'dialog.mergedTerminalCount'
                  | t: { name: targetWorkspace.name, count: mergedTerminalCount() }
              }}
            </span>
          </div>
        }

        <ul class="merge-notes">
          <li>{{ 'dialog.mergeKeepsTarget' | t }}</li>
          <li>{{ 'dialog.mergeRemovesSource' | t }}</li>
          <li>{{ 'dialog.mergeKeepsProcesses' | t }}</li>
        </ul>

        <footer>
          <button
            type="button"
            class="secondary btn btn-ghost btn-sm"
            [disabled]="merging()"
            (click)="cancel()"
          >
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="!targetWorkspaceId() || merging()"
            (click)="submit()"
          >
            <app-icon name="merge" [size]="14" />
            {{ merging() ? ('dialog.merging' | t) : ('dialog.confirmMerge' | t) }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrls: ['./dialog.scss', './merge-workspace-dialog.scss'],
})
export class MergeWorkspaceDialogComponent {
  readonly sourceWorkspace = input.required<Workspace>();
  readonly workspaces = input.required<Workspace[]>();
  readonly merging = input(false);
  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  protected readonly targetWorkspaceId = signal('');
  protected readonly targetWorkspaces = computed(() =>
    this.workspaces().filter((workspace) => workspace.id !== this.sourceWorkspace().id),
  );
  protected readonly selectedTargetWorkspace = computed(
    () =>
      this.targetWorkspaces().find((workspace) => workspace.id === this.targetWorkspaceId()) ??
      null,
  );
  protected readonly mergedTerminalCount = computed(() => {
    const targetWorkspace = this.selectedTargetWorkspace();
    if (!targetWorkspace) {
      return this.sourceWorkspace().terminals.length;
    }
    const terminalIds = new Set(targetWorkspace.terminals.map((terminal) => terminal.id));
    return (
      targetWorkspace.terminals.length +
      this.sourceWorkspace().terminals.filter((terminal) => !terminalIds.has(terminal.id)).length
    );
  });

  constructor() {
    effect(() => {
      const targets = this.targetWorkspaces();
      const selectedId = this.targetWorkspaceId();
      if (!targets.some((workspace) => workspace.id === selectedId)) {
        this.targetWorkspaceId.set(targets[0]?.id ?? '');
      }
    });
  }

  protected cancel(): void {
    if (!this.merging()) {
      this.cancelled.emit();
    }
  }

  protected submit(): void {
    const targetWorkspaceId = this.targetWorkspaceId();
    if (targetWorkspaceId && !this.merging()) {
      this.confirmed.emit(targetWorkspaceId);
    }
  }
}
