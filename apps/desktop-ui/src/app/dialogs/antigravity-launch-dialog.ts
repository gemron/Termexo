import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { AgentInstallation, AntigravityModel } from '../core/models/agent.models';
import { AGENT_ICONS } from '../core/models/workspace.models';
import { AgentService } from '../core/services/agent.service';
import { LaunchDialogShellComponent } from './launch-dialog-shell';

/** Reasoning depth, which the CLI takes as `--effort`. */
const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;

export interface AntigravityLaunchDialogValue {
  name: string;
  model?: string;
  effort?: string;
  continueLast?: boolean;
  autoConfirm?: boolean;
}

@Component({
  selector: 'app-antigravity-launch-dialog',
  imports: [FormsModule, LaunchDialogShellComponent, TranslatePipe],
  template: `
    <app-launch-dialog-shell
      [icon]="agentIcon"
      [heading]="'launch.newAntigravity' | t"
      [detecting]="'launch.detectingAntigravity' | t"
      [installation]="installation()"
      [workingDirectory]="workingDirectory()"
      [canLaunch]="canLaunch()"
      [launching]="launching()"
      [blockedReason]="blockedReason()"
      (launched)="submit()"
      (cancelled)="cancelled.emit()"
      (installRequested)="installRequested.emit()"
    >
      <div class="form-grid">
        <label class="wide session-name-field">
          <span>{{ 'launch.sessionName' | t }}</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            [placeholder]="'launch.antigravityNameExample' | t"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </label>
        <label class="model-field">
          <span>{{ 'launch.antigravityModel' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="model()"
            (ngModelChange)="model.set($event)"
          >
            <option value="">{{ 'launch.antigravityModelDefault' | t }}</option>
            @for (option of models(); track option.slug) {
              <option [value]="option.slug">{{ option.displayName }}</option>
            }
          </select>
          <small>{{ modelHelp() }}</small>
        </label>
        <label class="effort-field">
          <span>{{ 'launch.antigravityEffort' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="effort()"
            (ngModelChange)="effort.set($event)"
          >
            <option value="">{{ 'launch.antigravityEffortDefault' | t }}</option>
            @for (level of effortLevels; track level) {
              <option [value]="level">{{ level }}</option>
            }
          </select>
        </label>
        <label class="wide checkbox-control">
          <input
            type="checkbox"
            [ngModel]="continueLast()"
            (ngModelChange)="continueLast.set($event)"
          />
          <span>
            <strong>{{ 'launch.antigravityContinue' | t }}</strong>
            <small>{{ 'launch.antigravityContinueHelp' | t }}</small>
          </span>
        </label>
        <label class="wide checkbox-control auto-confirm-control">
          <input
            type="checkbox"
            [ngModel]="autoConfirm()"
            (ngModelChange)="autoConfirm.set($event)"
          />
          <span>
            <strong>{{ 'launch.autoConfirm' | t }}</strong>
            <small>{{ 'launch.antigravityAutoConfirmHelp' | t }}</small>
          </span>
        </label>
      </div>
    </app-launch-dialog-shell>
  `,
  styleUrls: ['./agent-dialog.scss', './launch-dialog.scss'],
})
export class AntigravityLaunchDialogComponent implements OnInit {
  /** Passed through to the workbench, which owns the settings window. */
  readonly installRequested = output<void>();

  /** The agent's own mark, which the heading shows. */
  protected readonly agentIcon = AGENT_ICONS.antigravity;

  readonly installation = input<AgentInstallation | null>(null);
  readonly workingDirectory = input('');
  readonly launching = input(false);
  readonly launched = output<AntigravityLaunchDialogValue>();
  readonly cancelled = output<void>();

  private readonly i18n = inject(I18nService);
  private readonly agents = inject(AgentService);

  protected readonly effortLevels = EFFORT_LEVELS;
  protected readonly name = signal('');
  protected readonly model = signal('');
  protected readonly effort = signal('');
  protected readonly continueLast = signal(false);
  protected readonly autoConfirm = signal(false);
  /** Reported by the CLI rather than known here, so it is empty until it answers. */
  protected readonly models = signal<readonly AntigravityModel[]>([]);
  private readonly modelsFailed = signal(false);

  protected readonly canLaunch = computed(() => Boolean(this.installation()?.healthy));
  protected readonly blockedReason = computed(() => {
    if (this.canLaunch()) {
      return '';
    }
    return this.installation()?.diagnostic ?? this.i18n.t('launch.detectingAntigravity');
  });

  /**
   * Antigravity reaches its own service, so its models are not Termexo's model profiles — the
   * list has to come from the CLI. It needs to be signed in to answer, so a failure leaves the
   * picker on the CLI's own default rather than blocking the launch.
   */
  protected readonly modelHelp = computed(() => {
    if (this.modelsFailed()) {
      return this.i18n.t('launch.antigravityModelUnavailable');
    }
    return this.i18n.t('launch.antigravityModelHelp');
  });

  ngOnInit(): void {
    void this.loadModels();
  }

  private async loadModels(): Promise<void> {
    try {
      this.models.set(await this.agents.listAntigravityModels());
    } catch {
      this.modelsFailed.set(true);
    }
  }

  protected submit(): void {
    if (!this.canLaunch()) {
      return;
    }
    this.launched.emit({
      name: this.name().trim(),
      model: this.model().trim() || undefined,
      effort: this.effort().trim() || undefined,
      continueLast: this.continueLast(),
      autoConfirm: this.autoConfirm(),
    });
  }
}
