import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

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
import { IconComponent } from '../shared/icon/icon';

export interface ClaudeLaunchDialogValue {
  name: string;
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
  autoConfirm?: boolean;
}

@Component({
  selector: 'app-claude-launch-dialog',
  imports: [FormsModule, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="agent-dialog compact modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="claude-launch-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div class="dialog-title">
            <span class="title-icon"><app-icon name="bot" [size]="17" /></span>
            <div>
              <h2 id="claude-launch-title">{{ 'launch.newClaude' | t }}</h2>
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
          <span>{{ installation()?.diagnostic ?? ('launch.detectingClaude' | t) }}</span>
          <code>{{ installation()?.version ?? '' }}</code>
        </div>

        <div class="form-grid">
          <label class="wide">
            <span>{{ 'launch.sessionName' | t }}</span>
            <input
              type="text"
              class="input input-bordered input-sm"
              [placeholder]="'launch.claudeNameExample' | t"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
              autofocus
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
            @if (selectedAccount() && !selectedAccount()?.authenticated) {
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
export class ClaudeLaunchDialogComponent {
  readonly installation = input<AgentInstallation | null>(null);
  readonly profiles = input<ModelProfile[]>([]);
  readonly mcpProfiles = input<McpProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly workingDirectory = input('');
  readonly launched = output<ClaudeLaunchDialogValue>();
  readonly cancelled = output<void>();

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
