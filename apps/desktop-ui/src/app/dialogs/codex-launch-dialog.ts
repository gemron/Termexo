import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AccountProfile,
  AgentInstallation,
  CODEX_MODEL_SUGGESTIONS,
  isNativeModel,
  profileModel,
  profileServes,
  resolveAccountProfileId,
  ModelProfile,
} from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';
import { LaunchDialogShellComponent } from './launch-dialog-shell';

export interface CodexLaunchDialogValue {
  name: string;
  model?: string;
  profileId?: string;
  accountProfileId?: string;
  autoConfirm?: boolean;
}

@Component({
  selector: 'app-codex-launch-dialog',
  imports: [FormsModule, IconComponent, LaunchDialogShellComponent, TranslatePipe],
  template: `
    <app-launch-dialog-shell
      icon="terminal"
      [heading]="'launch.newCodex' | t"
      [detecting]="'launch.detectingCodex' | t"
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
            [placeholder]="'launch.codexNameExample' | t"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </label>
        <label class="profile-field">
          <span>{{ 'launch.modelProfile' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="resolvedProfileId()"
            (ngModelChange)="onProfileChange($event)"
          >
            @for (profile of codexProfiles(); track profile.id) {
              <option [value]="profile.id">
                {{ profile.name }} · {{ modelOf(profile) }}
                @if (isNativeModel(profile)) {
                  ({{ 'settings.nativeModel' | t }})
                }
              </option>
            }
          </select>
          @if (!codexProfiles().length) {
            <small class="account-warning">{{ 'launch.noModelProfile' | t }}</small>
          }
        </label>
        <label class="account-field">
          <span>{{ 'launch.chatgptAccount' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="resolvedAccountProfileId()"
            (ngModelChange)="accountProfileId.set($event)"
          >
            @for (profile of codexAccounts(); track profile.id) {
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
          @if (!codexAccounts().length) {
            <small class="account-warning">{{ 'launch.noAccountProfile' | t }}</small>
          } @else if (selectedAccount() && !selectedAccount()?.authenticated) {
            <!-- Matches the Claude dialog: launching is allowed, but the CLI will ask to log in. -->
            <p class="account-blocker">
              <app-icon name="triangle-alert" [size]="13" />
              <span>{{ 'launch.accountNotAuthenticated' | t }}</span>
            </p>
          }
        </label>
        <label class="wide model-field">
          <span>{{ 'launch.codexModel' | t }}</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            list="codex-model-suggestions"
            [placeholder]="'launch.codexModelPlaceholder' | t"
            [attr.aria-label]="'launch.codexModel' | t"
            [ngModel]="resolvedModel()"
            (ngModelChange)="model.set($event)"
          />
          <datalist id="codex-model-suggestions">
            @for (suggestion of modelSuggestions; track suggestion) {
              <option [value]="suggestion"></option>
            }
          </datalist>
          <small>{{ 'launch.codexModelHelp' | t }}</small>
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
export class CodexLaunchDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly profiles = input<ModelProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly workingDirectory = input('');
  readonly launching = input(false);
  readonly launched = output<CodexLaunchDialogValue>();
  readonly cancelled = output<void>();

  private readonly i18n = inject(I18nService);

  protected readonly name = signal('');
  protected readonly model = signal('');
  protected readonly profileId = signal('');
  protected readonly accountProfileId = signal('');
  protected readonly autoConfirm = signal(false);
  protected readonly modelSuggestions = CODEX_MODEL_SUGGESTIONS;
  protected readonly codexAccounts = computed(() =>
    this.accountProfiles().filter((profile) => profile.agentType === 'codex'),
  );
  protected readonly selectedAccount = computed(() =>
    this.codexAccounts().find((profile) => profile.id === this.resolvedAccountProfileId()),
  );
  protected readonly codexProfiles = computed(() =>
    this.profiles().filter((profile) => profileServes(profile, 'codex')),
  );
  protected readonly resolvedAccountProfileId = computed(
    () => resolveAccountProfileId(this.accountProfiles(), 'codex', this.accountProfileId()) ?? '',
  );
  protected readonly resolvedProfileId = computed(
    () =>
      this.profileId() ||
      this.codexProfiles().find((profile) => profile.isDefault)?.id ||
      this.codexProfiles()[0]?.id ||
      '',
  );
  protected readonly resolvedModel = computed(() => {
    const explicit = this.model().trim();
    if (explicit) {
      return explicit;
    }
    const profile = this.codexProfiles().find(
      (candidate) => candidate.id === this.resolvedProfileId(),
    );
    return profile ? profileModel(profile, 'codex') : '';
  });
  protected readonly canLaunch = computed(
    () =>
      Boolean(this.installation()?.healthy) &&
      Boolean(this.resolvedProfileId()) &&
      Boolean(this.resolvedAccountProfileId()),
  );
  protected readonly blockedReason = computed(() => {
    if (this.canLaunch()) {
      return '';
    }
    const installation = this.installation();
    if (!installation?.healthy) {
      return installation?.diagnostic ?? this.i18n.t('launch.detectingCodex');
    }
    return this.i18n.t(
      this.resolvedProfileId() ? 'launch.noAccountProfile' : 'launch.noModelProfile',
    );
  });

  protected isNativeModel(profile: ModelProfile): boolean {
    return isNativeModel(profile, 'codex');
  }

  protected modelOf(profile: ModelProfile): string {
    return profileModel(profile, 'codex');
  }

  protected onProfileChange(profileId: string): void {
    this.profileId.set(profileId);
    const profile = this.codexProfiles().find((p) => p.id === profileId);
    if (profile) {
      // A model name belongs to its provider. Retaining the previous profile's value can launch an
      // official OpenAI provider with a MiniMax/DeepSeek model (or the inverse).
      this.model.set(profileModel(profile, 'codex'));
    }
  }

  protected submit(): void {
    if (!this.canLaunch()) {
      return;
    }
    this.launched.emit({
      name: this.name().trim(),
      model: this.resolvedModel() || undefined,
      profileId: this.resolvedProfileId() || undefined,
      accountProfileId: this.resolvedAccountProfileId() || undefined,
      autoConfirm: this.autoConfirm() || undefined,
    });
  }
}
