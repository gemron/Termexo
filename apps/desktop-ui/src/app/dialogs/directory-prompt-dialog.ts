import { Component, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';

/**
 * Asks for a working folder where no native directory dialog exists — the browser preview and,
 * more importantly, a phone on remote access.
 *
 * The folder is on the machine running the desktop app, so it cannot be browsed from here; the
 * workspace folder arrives prefilled and accepting it is a single tap.
 */
@Component({
  selector: 'app-directory-prompt-dialog',
  imports: [FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-prompt-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="directory-prompt-title">{{ title() }}</h2>
            <p>{{ 'dialog.directoryPromptDescription' | t }}</p>
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
          <span>{{ 'dialog.projectDirectory' | t }}</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            placeholder="D:\\dev\\project"
            [attr.aria-label]="'dialog.projectDirectory' | t"
            [ngModel]="directory()"
            (ngModelChange)="directory.set($event)"
            (keydown.enter)="submit()"
            autofocus
          />
        </label>

        <footer>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            [disabled]="!directory().trim()"
            (click)="submit()"
          >
            <app-icon name="folder" [size]="14" />
            {{ 'dialog.directoryPromptConfirm' | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './dialog.scss',
})
export class DirectoryPromptDialogComponent {
  readonly title = input.required<string>();
  readonly initialDirectory = input('');
  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  protected readonly directory = signal('');
  private initializedFor: string | null = null;

  constructor() {
    effect(() => {
      const initial = this.initialDirectory();
      // Only seeds the field; typing into it must not be undone by a later change detection.
      if (initial !== this.initializedFor) {
        this.initializedFor = initial;
        this.directory.set(initial);
      }
    });
  }

  protected submit(): void {
    const value = this.directory().trim();
    if (value) {
      this.submitted.emit(value);
    }
  }
}
