import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { type AgentInstallation } from '../core/models/agent.models';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { LaunchDialogShellComponent } from './launch-dialog-shell';

export interface OpenCodeLaunchDialogValue {
  name: string;
  model?: string;
  autoConfirm?: boolean;
}

@Component({
  selector: 'app-opencode-launch-dialog',
  imports: [FormsModule, LaunchDialogShellComponent, TranslatePipe],
  template: `
    <app-launch-dialog-shell
      icon="terminal"
      [heading]="'launch.newOpenCode' | t"
      [detecting]="'launch.detectingOpenCode' | t"
      [installation]="installation()"
      [workingDirectory]="workingDirectory()"
      [canLaunch]="canLaunch()"
      [launching]="launching()"
      [blockedReason]="blockedReason()"
      (launched)="submit()"
      (cancelled)="cancelled.emit()"
    >
      <div class="form-grid">
        <label class="wide session-name-field">
          <span>{{ 'launch.sessionName' | t }}</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            [placeholder]="'launch.openCodeNameExample' | t"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </label>
        <label class="wide model-field">
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
    </app-launch-dialog-shell>
  `,
  styleUrls: ['./agent-dialog.scss', './launch-dialog.scss'],
})
export class OpenCodeLaunchDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly workingDirectory = input('');
  readonly launching = input(false);
  readonly launched = output<OpenCodeLaunchDialogValue>();
  readonly cancelled = output<void>();

  private readonly i18n = inject(I18nService);

  protected readonly name = signal('');
  protected readonly model = signal('');
  protected readonly autoConfirm = signal(false);
  protected readonly canLaunch = computed(() => Boolean(this.installation()?.healthy));
  protected readonly blockedReason = computed(() => {
    if (this.canLaunch()) {
      return '';
    }
    return this.installation()?.diagnostic ?? this.i18n.t('launch.detectingOpenCode');
  });

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
