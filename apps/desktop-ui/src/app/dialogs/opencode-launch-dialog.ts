import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { type AgentInstallation } from '../core/models/agent.models';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';

export interface OpenCodeLaunchDialogValue {
  name: string;
  model?: string;
  autoConfirm?: boolean;
}

@Component({
  selector: 'app-opencode-launch-dialog',
  imports: [FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog compact modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="opencode-launch-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="terminal" [size]="17" /></span>
            <div>
              <h2 id="opencode-launch-title">{{ 'launch.newOpenCode' | t }}</h2>
              <p>{{ workingDirectory() }}</p>
            </div>
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

        <div class="installation-line" [class.unavailable]="!installation()?.healthy">
          <i></i>
          <span>{{ installation()?.diagnostic ?? ('launch.detectingOpenCode' | t) }}</span>
          <code>{{ installation()?.version ?? '' }}</code>
        </div>

        <div class="form-grid">
          <label class="wide">
            <span>{{ 'launch.sessionName' | t }}</span>
            <input
              type="text"
              class="input input-bordered input-sm"
              [placeholder]="'launch.openCodeNameExample' | t"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              autofocus
            />
          </label>
          <label class="wide">
            <span>{{ 'launch.openCodeModel' | t }}</span>
            <input
              type="text"
              class="input input-bordered input-sm"
              [placeholder]="'launch.openCodeModelPlaceholder' | t"
              [ngModel]="model()"
              (ngModelChange)="model.set($event)"
            />
            <small>{{ 'launch.openCodeModelHelp' | t }}</small>
          </label>
          <label class="wide checkbox-control auto-confirm-control">
            <input
              type="checkbox"
              [ngModel]="autoConfirm()"
              (ngModelChange)="autoConfirm.set($event)"
            />
            <span>
              <strong>{{ 'launch.autoConfirm' | t }}</strong>
              <small>{{ 'launch.autoConfirmHelp' | t }}</small>
            </span>
          </label>
        </div>

        <footer>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="!canLaunch()"
            (click)="submit()"
          >
            <app-icon name="play" [size]="13" />{{ 'launch.start' | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './agent-dialog.scss',
})
export class OpenCodeLaunchDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly workingDirectory = input('');
  readonly launched = output<OpenCodeLaunchDialogValue>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly model = signal('');
  protected readonly autoConfirm = signal(false);
  protected readonly canLaunch = computed(() => Boolean(this.installation()?.healthy));

  protected submit(): void {
    if (!this.canLaunch()) {
      return;
    }
    this.launched.emit({
      name: this.name().trim(),
      model: this.model().trim() || undefined,
      autoConfirm: this.autoConfirm(),
    });
  }
}
