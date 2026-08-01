import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Workspace } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-merge-workspace-dialog',
  imports: [FormsModule, IconComponent],
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
            <h2 id="merge-workspace-dialog-title">合并工作空间</h2>
            <p>将一个工作空间中的终端统一移动到另一个工作空间。</p>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            title="关闭"
            aria-label="关闭"
            [disabled]="merging()"
            (click)="cancel()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="merge-source">
          <span class="merge-workspace-icon"><app-icon name="folder" [size]="18" /></span>
          <span>
            <small>来源工作空间</small>
            <strong>{{ sourceWorkspace().name }}</strong>
            <code>{{ sourceWorkspace().projectPath }}</code>
          </span>
          <em>{{ sourceWorkspace().terminals.length }} 个终端</em>
        </div>

        <div class="merge-direction" aria-hidden="true">
          <span></span>
          <app-icon name="merge" [size]="17" />
          <span></span>
        </div>

        <label class="merge-target-field">
          <span>合并到</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="targetWorkspaceId()"
            (ngModelChange)="targetWorkspaceId.set($event)"
            [disabled]="merging() || targetWorkspaces().length === 0"
          >
            @for (workspace of targetWorkspaces(); track workspace.id) {
              <option [value]="workspace.id">
                {{ workspace.name }} · {{ workspace.terminals.length }} 个终端
              </option>
            }
          </select>
        </label>

        @if (selectedTargetWorkspace(); as targetWorkspace) {
          <div class="merge-preview">
            <app-icon name="merge" [size]="16" />
            <span>
              合并后“{{ targetWorkspace.name }}”共有
              <strong>{{ mergedTerminalCount() }}</strong> 个终端
            </span>
          </div>
        }

        <ul class="merge-notes">
          <li>目标工作空间的名称、项目目录、主题和布局保持不变。</li>
          <li>来源工作空间配置会被删除，但不会删除任何本地项目文件。</li>
          <li>正在运行的终端进程会继续运行。</li>
        </ul>

        <footer>
          <button
            type="button"
            class="secondary btn btn-ghost btn-sm"
            [disabled]="merging()"
            (click)="cancel()"
          >
            取消
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="!targetWorkspaceId() || merging()"
            (click)="submit()"
          >
            <app-icon name="merge" [size]="14" />
            {{ merging() ? '正在合并…' : '确认合并' }}
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
