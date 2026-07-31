import { Component, input, output } from '@angular/core';

import { Workspace } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-delete-workspace-dialog',
  imports: [IconComponent],
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
            <h2 id="delete-workspace-dialog-title">删除工作空间</h2>
            <p>该操作只删除 Termexo 中的工作空间配置，不会删除本地项目文件。</p>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            title="关闭"
            aria-label="关闭"
            [disabled]="deleting()"
            (click)="cancelled.emit()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <div class="delete-workspace-summary alert alert-warning">
          <app-icon name="trash" [size]="18" />
          <div>
            <strong>确定删除“{{ workspace().name }}”吗？</strong>
            <span>{{ workspace().projectPath }}</span>
          </div>
        </div>

        @if (workspace().terminals.length > 0) {
          <p class="delete-workspace-warning">
            删除时将停止并关闭该工作空间中的 {{ workspace().terminals.length }} 个终端进程。
          </p>
        }

        <footer>
          <button
            type="button"
            class="secondary btn btn-ghost btn-sm"
            [disabled]="deleting()"
            (click)="cancelled.emit()"
          >
            取消
          </button>
          <button
            type="button"
            class="btn btn-error btn-sm"
            [disabled]="deleting()"
            (click)="confirmed.emit()"
          >
            <app-icon name="trash" [size]="14" />
            {{ deleting() ? '正在删除…' : '删除工作空间' }}
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
