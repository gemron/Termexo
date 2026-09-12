import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AccountProfile,
  AgentInstallation,
  CLAUDE_EFFORT_LEVELS,
  isNativeModel,
  profileModel,
  profileServes,
  resolveAccountProfileId,
  McpProfile,
  ModelProfile,
} from '../core/models/agent.models';
import { AGENT_ICONS } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';
import { LaunchDialogShellComponent } from './launch-dialog-shell';

export interface ClaudeLaunchDialogValue {
  name: string;
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
  autoConfirm?: boolean;
  /** Overrides the profile's settings for this launch only; omitted keeps what it stores. */
  context1m?: boolean;
  effort?: string;
}

/**
 * The 1M window is a three-state choice, not a checkbox: a launch may follow the profile, or
 * override it either way, and an unchecked box could not tell the first case from the last.
 */
const CONTEXT_1M_ON = 'on';
const CONTEXT_1M_OFF = 'off';

@Component({
  selector: 'app-claude-launch-dialog',
  imports: [FormsModule, IconComponent, LaunchDialogShellComponent, TranslatePipe],
  template: `
    <app-launch-dialog-shell
      [icon]="agentIcon"
      [heading]="'launch.newClaude' | t"
      [detecting]="'launch.detectingClaude' | t"
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
            <!--
              Loud rather than a footnote: launching anyway is allowed and sometimes what the
              user wants, but the terminal will open straight into the CLI's login prompt, and
              that surprise reads as Termexo ignoring the account that was picked.
            -->
            <p class="account-blocker">
              <app-icon name="triangle-alert" [size]="13" />
              <span>{{ 'launch.accountNotAuthenticated' | t }}</span>
            </p>
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
        <label class="effort-field">
          <span>{{ 'settings.effortLevel' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="effort()"
            (ngModelChange)="effort.set($event)"
          >
            <option value="">{{ 'launch.followProfile' | t }}</option>
            @for (level of effortLevels; track level) {
              <option [value]="level">{{ level }}</option>
            }
          </select>
        </label>
        <label class="context-field">
          <span>{{ 'settings.context1m' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="context1m()"
            (ngModelChange)="context1m.set($event)"
          >
            <option value="">{{ 'launch.followProfile' | t }}</option>
            <option [value]="contextOn">{{ 'launch.context1mOn' | t }}</option>
            <option [value]="contextOff">{{ 'launch.context1mOff' | t }}</option>
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
  /** Passed through to the workbench, which owns the settings window. */
  readonly installRequested = output<void>();

  /** The agent's own mark, which the heading shows. */
  protected readonly agentIcon = AGENT_ICONS.claude;

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
  protected readonly effort = signal('');
  protected readonly context1m = signal('');
  protected readonly effortLevels = CLAUDE_EFFORT_LEVELS;
  protected readonly contextOn = CONTEXT_1M_ON;
  protected readonly contextOff = CONTEXT_1M_OFF;
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
      context1m: this.selectedContext1m(),
      effort: this.effort() || undefined,
    });
  }

  /** `undefined` leaves the profile's own setting in place, which is what an empty choice means. */
  private selectedContext1m(): boolean | undefined {
    const choice = this.context1m();
    return choice ? choice === CONTEXT_1M_ON : undefined;
  }
}
