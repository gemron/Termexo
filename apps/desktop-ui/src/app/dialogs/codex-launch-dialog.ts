import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AccountProfile,
  AgentInstallation,
  CODEX_MODEL_SUGGESTIONS,
  isNativeModel,
  profileModel,
  profileServes,
  ModelProfile,
} from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

export interface CodexLaunchDialogValue {
  name: string;
  model?: string;
  profileId?: string;
  accountProfileId?: string;
}

@Component({
  selector: 'app-codex-launch-dialog',
  imports: [FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog compact codex-launch-dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-launch-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="terminal" [size]="17" /></span>
            <div>
              <h2 id="codex-launch-title">{{ 'launch.newCodex' | t }}</h2>
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
          <span>{{ installation()?.diagnostic ?? ('launch.detectingCodex' | t) }}</span>
          <code>{{ installation()?.version ?? '' }}</code>
        </div>

        <div class="form-grid codex-launch-form">
          <label class="wide session-name-field">
            <span>{{ 'launch.sessionName' | t }}</span>
            <input
              type="text"
              class="input input-bordered input-sm"
              [placeholder]="'launch.codexNameExample' | t"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              autofocus
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
            @if (selectedAccount() && !selectedAccount()?.authenticated) {
              <small class="account-warning">{{ 'launch.accountNotAuthenticated' | t }}</small>
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
  styleUrls: ['./agent-dialog.scss', './codex-launch-dialog.scss'],
})
export class CodexLaunchDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly profiles = input<ModelProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly workingDirectory = input('');
  readonly launched = output<CodexLaunchDialogValue>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly model = signal('');
  protected readonly profileId = signal('');
  protected readonly accountProfileId = signal('');
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
    () =>
      this.accountProfileId() ||
      this.codexAccounts().find((profile) => profile.isDefault)?.id ||
      this.codexAccounts()[0]?.id ||
      '',
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
    });
  }
}
