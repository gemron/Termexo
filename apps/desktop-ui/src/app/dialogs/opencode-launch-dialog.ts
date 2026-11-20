import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  type AccountProfile,
  type AgentInstallation,
  resolveAccountProfileId,
} from '../core/models/agent.models';
import { AGENT_ICONS } from '../core/models/workspace.models';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';
import { LaunchDialogShellComponent } from './launch-dialog-shell';

export interface OpenCodeLaunchDialogValue {
  name: string;
  model?: string;
  accountProfileId?: string;
  autoConfirm?: boolean;
}

@Component({
  selector: 'app-opencode-launch-dialog',
  imports: [FormsModule, IconComponent, LaunchDialogShellComponent, TranslatePipe],
  template: `
    <app-launch-dialog-shell
      [icon]="agentIcon"
      [heading]="'launch.newOpenCode' | t"
      [detecting]="'launch.detectingOpenCode' | t"
      [installation]="installation()"
      [workingDirectory]="workingDirectory()"
      [canLaunch]="canLaunch()"
      [launching]="launching()"
      [blockedReason]="blockedReason()"
      (launched)="submit()"
      (cancelled)="cancelled.emit()"
      (installRequested)="installRequested.emit()"
      (directoryChangeRequested)="directoryChangeRequested.emit()"
    >
      <div class="form-grid">
        <label class="wide session-name-field">
          <span>{{ 'launch.sessionName' | t }}</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            autofocus
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
        @if (openCodeAccounts().length) {
          <label class="wide">
            <span>{{ 'launch.loginAccount' | t }}</span>
            <select
              class="select select-bordered select-sm"
              [ngModel]="resolvedAccountProfileId()"
              (ngModelChange)="accountProfileId.set($event)"
            >
              @for (profile of openCodeAccounts(); track profile.id) {
                <option [value]="profile.id">
                  {{ profile.name }} ·
                  {{
                    profile.authenticated
                      ? ('common.authenticated' | t)
                      : ('common.unauthenticated' | t)
                  }}
                </option>
              }
            </select>
            @if (selectedAccount() && !selectedAccount()?.authenticated) {
              <p class="account-blocker">
                <app-icon name="triangle-alert" [size]="13" />
                <span>{{ 'launch.accountNotAuthenticated' | t }}</span>
              </p>
            }
          </label>
        }
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
  /** Passed through to the workbench, which owns the settings window. */
  readonly installRequested = output<void>();
  readonly directoryChangeRequested = output<void>();

  /** The agent's own mark, which the heading shows. */
  protected readonly agentIcon = AGENT_ICONS.opencode;

  readonly installation = input<AgentInstallation | null>(null);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly workingDirectory = input('');
  readonly launching = input(false);
  readonly launched = output<OpenCodeLaunchDialogValue>();
  readonly cancelled = output<void>();

  private readonly i18n = inject(I18nService);

  protected readonly name = signal('');
  protected readonly model = signal('');
  protected readonly accountProfileId = signal('');
  protected readonly autoConfirm = signal(false);
  protected readonly openCodeAccounts = computed(() =>
    this.accountProfiles().filter((profile) => profile.agentType === 'opencode'),
  );
  protected readonly resolvedAccountProfileId = computed(
    () =>
      resolveAccountProfileId(
        this.accountProfiles(),
        'opencode',
        this.accountProfileId() || undefined,
      ) ?? '',
  );
  protected readonly selectedAccount = computed(() =>
    this.openCodeAccounts().find((profile) => profile.id === this.resolvedAccountProfileId()),
  );
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
      accountProfileId: this.resolvedAccountProfileId() || undefined,
      autoConfirm: this.autoConfirm(),
    });
  }
}
