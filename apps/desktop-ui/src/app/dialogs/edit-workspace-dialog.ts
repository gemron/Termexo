import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
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
  imports: [FormsModule, IconComponent, TranslatePipe],
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
            <h2 id="edit-workspace-dialog-title">{{ 'dialog.workspaceEditTitle' | t }}</h2>
            <p>{{ 'dialog.workspaceEditDescription' | t }}</p>
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

        <label>
          <span>{{ 'dialog.workspaceName' | t }}</span>
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
          <span>{{ 'dialog.projectDirectory' | t }}</span>
          <code>{{ workspace().projectPath }}</code>
        </div>

        <fieldset>
          <legend>{{ 'dialog.themeColor' | t }}</legend>
          <div class="theme-presets">
            @for (preset of themePresets; track preset.color) {
              <button
                type="button"
                class="theme-swatch"
                [class.selected]="themeColor() === preset.color"
                [style.--swatch-color]="preset.color"
                [attr.aria-label]="themePresetLabel(preset.color)"
                [attr.title]="themePresetLabel(preset.color)"
                [attr.aria-pressed]="themeColor() === preset.color"
                (click)="themeColor.set(preset.color)"
              >
                <i></i>
                <span>{{ themePresetLabel(preset.color) }}</span>
                @if (themeColor() === preset.color) {
                  <app-icon name="check" [size]="12" />
                }
              </button>
            }
          </div>
        </fieldset>

        <div class="custom-color">
          <label for="workspace-theme-color">{{ 'dialog.customColor' | t }}</label>
          <input
            id="workspace-theme-color"
            type="color"
            [value]="themeColor()"
            (input)="selectThemeColor($event)"
          />
          <code>{{ themeColor() }}</code>
          <span class="theme-preview" [style.--preview-color]="themeColor()">
            <i></i>{{ name().trim() || ('dialog.workspacePreview' | t) }}
          </span>
        </div>

        <footer>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="!isValid()"
            (click)="submit()"
          >
            {{ 'dialog.saveChanges' | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrls: ['./dialog.scss', './edit-workspace-dialog.scss'],
})
export class EditWorkspaceDialogComponent {
  private readonly i18n = inject(I18nService);
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

  protected themePresetLabel(color: string): string {
    const keys: Readonly<Record<string, string>> = {
      '#58c7a0': 'theme.emerald',
      '#68a9e8': 'theme.oceanBlue',
      '#a78bfa': 'theme.violet',
      '#e4a35a': 'theme.warmOrange',
      '#ef7890': 'theme.rose',
      '#52c7d9': 'theme.cyan',
    };
    return this.i18n.t(keys[color] ?? 'dialog.customColor');
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
