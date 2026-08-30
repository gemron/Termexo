import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AccountProfile,
  AgentInstallation,
  isNativeModel,
  profileModel,
  profileServes,
  resolveAccountProfileId,
  McpProfile,
  ModelProfile,
} from '../core/models/agent.models';
import { LaunchDialogShellComponent } from './launch-dialog-shell';

export interface ClaudeLaunchDialogValue {
  name: string;
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
  autoConfirm?: boolean;
}

@Component({
  selector: 'app-claude-launch-dialog',
  imports: [FormsModule, LaunchDialogShellComponent, TranslatePipe],
  template: `
    <app-launch-dialog-shell
      icon="bot"
      [heading]="'launch.newClaude' | t"
      [detecting]="'launch.detectingClaude' | t"
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
            [placeholder]="'launch.claudeNameExample' | t"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </label>
        <label>
          <span>{{ 'launch.modelProfile' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="resolvedProfileId()"
            (ngModelChange)="profileId.set($event)"
          >
            @for (profile of claudeProfiles(); track profile.id) {
              <option [value]="profile.id">
                {{ profile.name }} · {{ modelOf(profile) }}
                @if (isNativeModel(profile)) {
                  ({{ 'settings.nativeModel' | t }})
                }
              </option>
            }
          </select>
          @if (!claudeProfiles().length) {
            <small class="account-warning">{{ 'launch.noModelProfile' | t }}</small>
          }
        </label>
        <label>
          <span>{{ 'launch.loginAccount' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="resolvedAccountProfileId()"
            (ngModelChange)="accountProfileId.set($event)"
          >
            @for (profile of claudeAccounts(); track profile.id) {
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
          @if (!claudeAccounts().length) {
            <small class="account-warning">{{ 'launch.noAccountProfile' | t }}</small>
          } @else if (selectedAccount() && !selectedAccount()?.authenticated) {
            <small class="account-warning">{{ 'launch.accountNotAuthenticated' | t }}</small>
          }
        </label>
        <label>
          <span>{{ 'launch.mcpProfile' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="mcpProfileId()"
            (ngModelChange)="mcpProfileId.set($event)"
          >
            <option value="">{{ 'launch.claudeDefault' | t }}</option>
            @for (profile of mcpProfiles(); track profile.id) {
              <option [value]="profile.id">{{ profile.name }}</option>
            }
          </select>
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
export class ClaudeLaunchDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly profiles = input<ModelProfile[]>([]);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly workingDirectory = input('');
  readonly launching = input(false);
  readonly launched = output<ClaudeLaunchDialogValue>();
  readonly cancelled = output<void>();

  private readonly i18n = inject(I18nService);

  protected readonly name = signal('');
  protected readonly profileId = signal('');
  protected readonly mcpProfileId = signal('');
  protected readonly accountProfileId = signal('');
  protected readonly autoConfirm = signal(false);
  protected readonly claudeAccounts = computed(() =>
    this.accountProfiles().filter((profile) => profile.agentType === 'claude'),
  );
  protected readonly selectedAccount = computed(() =>
    this.claudeAccounts().find((profile) => profile.id === this.resolvedAccountProfileId()),
  );
  protected readonly claudeProfiles = computed(() =>
    this.profiles().filter((profile) => profileServes(profile, 'claude')),
  );
  protected readonly resolvedAccountProfileId = computed(
    () => resolveAccountProfileId(this.accountProfiles(), 'claude', this.accountProfileId()) ?? '',
  );
  protected readonly resolvedProfileId = computed(
    () =>
      this.profileId() ||
      this.claudeProfiles().find((profile) => profile.isDefault)?.id ||
      this.claudeProfiles()[0]?.id ||
      '',
  );
  protected readonly canLaunch = computed(
    () => Boolean(this.installation()?.healthy) && Boolean(this.resolvedProfileId()),
  );
  protected readonly blockedReason = computed(() => {
    if (this.canLaunch()) {
      return '';
    }
    const installation = this.installation();
    if (!installation?.healthy) {
      return installation?.diagnostic ?? this.i18n.t('launch.detectingClaude');
    }
    return this.i18n.t('launch.noModelProfile');
  });

  protected isNativeModel(profile: ModelProfile): boolean {
    return isNativeModel(profile, 'claude');
  }

  protected modelOf(profile: ModelProfile): string {
    return profileModel(profile, 'claude');
  }

  protected submit(): void {
    if (!this.canLaunch()) {
      return;
    }
    this.launched.emit({
      name: this.name().trim(),
      profileId: this.resolvedProfileId() || undefined,
      mcpProfileId: this.mcpProfileId() || undefined,
      accountProfileId: this.resolvedAccountProfileId() || undefined,
      autoConfirm: this.autoConfirm() || undefined,
    });
  }
}
