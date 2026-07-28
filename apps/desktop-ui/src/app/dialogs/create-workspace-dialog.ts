import { Component, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-create-workspace-dialog',
  imports: [FormsModule, IconComponent],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="workspace-dialog-title">新建工作区</h2>
            <p>关联一个本地项目目录。</p>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            title="关闭"
            aria-label="关闭"
            (click)="cancelled.emit()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>
        <label>
          <span>名称</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            placeholder="例如：MTS Cloud"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            autofocus
          />
        </label>
        <label>
          <span>项目目录</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            placeholder="D:\\dev\\project"
            [ngModel]="projectPath()"
            (ngModelChange)="projectPath.set($event)"
          />
        </label>
        <footer>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            取消
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="!isValid()"
            (click)="submit()"
          >
            创建工作区
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './dialog.scss',
})
export class CreateWorkspaceDialogComponent {
  readonly created = output<{ name: string; projectPath: string }>();
  readonly cancelled = output<void>();
  readonly name = signal('');
  readonly projectPath = signal('');

  protected isValid(): boolean {
    return this.name().trim().length > 0 && this.projectPath().trim().length > 0;
  }

  protected submit(): void {
    if (this.isValid()) {
      this.created.emit({
        name: this.name().trim(),
        projectPath: this.projectPath().trim(),
      });
    }
  }
}
