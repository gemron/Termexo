import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { DirectoryPickerService } from '../core/services/directory-picker.service';
import { ModalFocusDirective } from '../shared/modal-focus.directive';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-create-workspace-dialog',
  imports: [ModalFocusDirective, FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancel()">
      <section
        class="dialog modal-box"
        appModal
        (dismissModal)="cancel()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dialog-title"
        [attr.aria-busy]="busy()"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="workspace-dialog-title">{{ 'dialog.workspaceCreateTitle' | t }}</h2>
            <p>{{ 'dialog.workspaceCreateDescription' | t }}</p>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            [title]="'common.close' | t"
            [attr.aria-label]="'common.close' | t"
            [disabled]="busy()"
            (click)="cancel()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>
        <label>
          <span>{{ 'dialog.name' | t }}</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            [placeholder]="'dialog.nameExample' | t"
            [ngModel]="name()"
            [disabled]="busy()"
            (ngModelChange)="name.set($event)"
            autofocus
          />
        </label>
        <label>
          <span>{{ 'dialog.workspaceDefaultDirectory' | t }}</span>
          <div class="directory-field">
            <input
              type="text"
              class="input input-bordered input-sm"
              placeholder="D:\\dev\\project"
              [attr.aria-label]="'dialog.workspaceProjectDirectory' | t"
              [ngModel]="projectPath()"
              [disabled]="busy()"
              (ngModelChange)="projectPath.set($event); directoryError.set(null)"
            />
            <button
              type="button"
              class="directory-button btn btn-outline btn-sm"
              [disabled]="busy() || selectingDirectory()"
              (click)="selectProjectDirectory()"
            >
              <app-icon name="folder" [size]="14" />
              {{ selectingDirectory() ? ('common.selecting' | t) : ('common.selectDirectory' | t) }}
            </button>
          </div>
          <small>{{ 'dialog.workspaceDirectoryHelp' | t }}</small>
          @if (directoryError(); as error) {
            <small class="field-error">{{ error }}</small>
          }
        </label>
        @if (error(); as message) {
          <p class="field-error" role="alert">{{ message }}</p>
        }
        <footer>
          <button
            type="button"
            class="secondary btn btn-ghost btn-sm"
            [disabled]="busy()"
            (click)="cancel()"
          >
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="busy() || selectingDirectory() || !isValid()"
            (click)="submit()"
          >
            {{ (busy() ? 'common.loading' : 'dialog.createWorkspace') | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrls: ['./dialog.scss', './create-workspace-dialog.scss'],
})
export class CreateWorkspaceDialogComponent {
  private readonly directoryPicker = inject(DirectoryPickerService);
  private readonly i18n = inject(I18nService);

  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly created = output<{ name: string; projectPath: string }>();
  readonly cancelled = output<void>();
  readonly name = signal('');
  readonly projectPath = signal('');
  readonly selectingDirectory = signal(false);
  readonly directoryError = signal<string | null>(null);

  protected async selectProjectDirectory(): Promise<void> {
    if (this.busy() || this.selectingDirectory()) {
      return;
    }

    this.selectingDirectory.set(true);
    this.directoryError.set(null);
    try {
      const selected = await this.directoryPicker.select(
        this.projectPath().trim() || undefined,
        this.i18n.t('dialog.selectWorkspaceDirectory'),
      );
      if (!selected) {
        return;
      }

      this.projectPath.set(selected);
      if (!this.name().trim()) {
        this.name.set(this.directoryName(selected));
      }
    } catch {
      this.directoryError.set(this.i18n.t('dialog.directoryPickerFailed'));
    } finally {
      this.selectingDirectory.set(false);
    }
  }

  protected isValid(): boolean {
    return this.name().trim().length > 0 && this.projectPath().trim().length > 0;
  }

  protected submit(): void {
    if (!this.busy() && !this.selectingDirectory() && this.isValid()) {
      this.created.emit({
        name: this.name().trim(),
        projectPath: this.projectPath().trim(),
      });
    }
  }

  protected cancel(): void {
    if (!this.busy()) this.cancelled.emit();
  }

  private directoryName(path: string): string {
    const normalized = path.trim().replace(/[\\/]+$/, '');
    return (
      normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? this.i18n.t('dialog.newWorkspaceFallback')
    );
  }
}
