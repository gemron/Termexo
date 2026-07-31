import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { DirectoryPickerService } from '../core/services/directory-picker.service';
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
          <div class="directory-field">
            <input
              type="text"
              class="input input-bordered input-sm"
              placeholder="D:\\dev\\project"
              aria-label="工作空间项目目录"
              [ngModel]="projectPath()"
              (ngModelChange)="projectPath.set($event); directoryError.set(null)"
            />
            <button
              type="button"
              class="directory-button btn btn-outline btn-sm"
              [disabled]="selectingDirectory()"
              (click)="selectProjectDirectory()"
            >
              <app-icon name="folder" [size]="14" />
              {{ selectingDirectory() ? '选择中…' : '选择目录' }}
            </button>
          </div>
          @if (directoryError(); as error) {
            <small class="field-error">{{ error }}</small>
          }
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
  styleUrls: ['./dialog.scss', './create-workspace-dialog.scss'],
})
export class CreateWorkspaceDialogComponent {
  private readonly directoryPicker = inject(DirectoryPickerService);

  readonly created = output<{ name: string; projectPath: string }>();
  readonly cancelled = output<void>();
  readonly name = signal('');
  readonly projectPath = signal('');
  readonly selectingDirectory = signal(false);
  readonly directoryError = signal<string | null>(null);

  protected async selectProjectDirectory(): Promise<void> {
    if (this.selectingDirectory()) {
      return;
    }

    this.selectingDirectory.set(true);
    this.directoryError.set(null);
    try {
      const selected = await this.directoryPicker.select(
        this.projectPath().trim() || undefined,
        '选择工作空间项目目录',
      );
      if (!selected) {
        return;
      }

      this.projectPath.set(selected);
      if (!this.name().trim()) {
        this.name.set(this.directoryName(selected));
      }
    } catch {
      this.directoryError.set('无法打开目录选择器，请检查系统权限或手动输入路径。');
    } finally {
      this.selectingDirectory.set(false);
    }
  }

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

  private directoryName(path: string): string {
    const normalized = path.trim().replace(/[\\/]+$/, '');
    return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? '新工作空间';
  }
}
