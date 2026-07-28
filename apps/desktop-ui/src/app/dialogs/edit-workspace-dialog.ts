import { Component, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  normalizeWorkspaceThemeColor,
  Workspace,
  WORKSPACE_THEME_PRESETS,
} from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

export interface WorkspaceAppearanceValue {
  workspaceId: string;
  name: string;
  themeColor: string;
}

@Component({
  selector: 'app-edit-workspace-dialog',
  imports: [FormsModule, IconComponent],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="dialog workspace-dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-workspace-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="edit-workspace-dialog-title">编辑工作区</h2>
            <p>修改工作区名称和独立主题颜色。</p>
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
          <span>工作区名称</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            (keydown.enter)="submit()"
            autofocus
          />
        </label>

        <div class="project-path">
          <span>项目目录</span>
          <code>{{ workspace().projectPath }}</code>
        </div>

        <fieldset>
          <legend>主题颜色</legend>
          <div class="theme-presets">
            @for (preset of themePresets; track preset.color) {
              <button
                type="button"
                class="theme-swatch"
                [class.selected]="themeColor() === preset.color"
                [style.--swatch-color]="preset.color"
                [attr.aria-label]="preset.name"
                [attr.title]="preset.name"
                [attr.aria-pressed]="themeColor() === preset.color"
                (click)="themeColor.set(preset.color)"
              >
                <i></i>
                <span>{{ preset.name }}</span>
                @if (themeColor() === preset.color) {
                  <app-icon name="check" [size]="12" />
                }
              </button>
            }
          </div>
        </fieldset>

        <div class="custom-color">
          <label for="workspace-theme-color">自定义颜色</label>
          <input
            id="workspace-theme-color"
            type="color"
            [value]="themeColor()"
            (input)="selectThemeColor($event)"
          />
          <code>{{ themeColor() }}</code>
          <span class="theme-preview" [style.--preview-color]="themeColor()">
            <i></i>{{ name().trim() || '工作区预览' }}
          </span>
        </div>

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
            保存修改
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrls: ['./dialog.scss', './edit-workspace-dialog.scss'],
})
export class EditWorkspaceDialogComponent {
  readonly workspace = input.required<Workspace>();
  readonly saved = output<WorkspaceAppearanceValue>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly themeColor = signal(normalizeWorkspaceThemeColor(undefined));
  protected readonly themePresets = WORKSPACE_THEME_PRESETS;
  private initializedWorkspaceId: string | null = null;

  constructor() {
    effect(() => {
      const workspace = this.workspace();
      if (workspace.id !== this.initializedWorkspaceId) {
        this.initializedWorkspaceId = workspace.id;
        this.name.set(workspace.name);
        this.themeColor.set(normalizeWorkspaceThemeColor(workspace.themeColor));
      }
    });
  }

  protected selectThemeColor(event: Event): void {
    this.themeColor.set(normalizeWorkspaceThemeColor((event.target as HTMLInputElement).value));
  }

  protected isValid(): boolean {
    return this.name().trim().length > 0;
  }

  protected submit(): void {
    if (!this.isValid()) {
      return;
    }
    this.saved.emit({
      workspaceId: this.workspace().id,
      name: this.name().trim(),
      themeColor: normalizeWorkspaceThemeColor(this.themeColor()),
    });
  }
}
