import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AccountProfile,
  AgentInstallation,
  CODEX_REASONING_EFFORT_LEVELS,
  isNativeModel,
  profileModel,
  profileServes,
  resolveAccountProfileId,
  ModelProfile,
} from '../core/models/agent.models';
import { AGENT_ICONS } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';
import { LaunchDialogShellComponent } from './launch-dialog-shell';
import { CodexModelCatalogService } from '../core/services/codex-model-catalog.service';
import { launchProfileId, officialModelId, OFFICIAL_MODEL_PREFIX } from '../core/models/launch-model-choice';

export interface CodexLaunchDialogValue {
  name: string;
  model?: string;
  profileId?: string;
  accountProfileId?: string;
  autoConfirm?: boolean;
  /** Overrides the profile's reasoning depth for this launch only; omitted keeps what it stores. */
  reasoningEffort?: string;
}

@Component({
  selector: 'app-codex-launch-dialog',
  imports: [FormsModule, IconComponent, LaunchDialogShellComponent, TranslatePipe],
  template: `
    <app-launch-dialog-shell
      [icon]="agentIcon"
      [heading]="oneRing() ? 'One Ring · Codex Coordinator' : ('launch.newCodex' | t)"
      [detecting]="'launch.detectingCodex' | t"
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
        @if (oneRing()) {
          <p class="wide">此会话通过 One Ring 编排任务。计划、修复和交付需要单独确认。</p>
        }
        <label class="wide session-name-field">
          <span>{{ 'launch.sessionName' | t }}</span>
          <input
            type="text"
            class="input input-bordered input-sm"
            autofocus
            [placeholder]="'launch.codexNameExample' | t"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </label>
        <label class="profile-field">
          <span>{{ 'launch.modelChoice' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [ngModel]="resolvedProfileId()"
            (ngModelChange)="onProfileChange($event)"
          >
            <optgroup [label]="'launch.officialModels' | t">
              <option value="official:">{{ 'launch.cliDefaultModel' | t }}{{ configuredDefault() ? ' · ' + configuredDefault() : '' }}</option>
              @for (model of officialModels(); track model) { <option [value]="'official:' + model">{{ model }}</option> }
            </optgroup>
            <optgroup [label]="'launch.savedProfiles' | t">
              @for (profile of codexProfiles(); track profile.id) {
              <option [value]="profile.id">
                {{ profile.name }} · {{ modelOf(profile) }}
                @if (isNativeModel(profile)) {
                  ({{ 'settings.nativeModel' | t }})
                }
              </option>
              }
            </optgroup>
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
            [placeholder]="configuredDefault() || ('launch.codexModelPlaceholder' | t)"
            [attr.aria-label]="'launch.codexModel' | t"
            [ngModel]="resolvedModel()"
            (ngModelChange)="model.set($event)"
          />
          <datalist id="codex-model-suggestions">
            @for (suggestion of modelSuggestions(); track suggestion) {
              <option [value]="suggestion"></option>
            }
          </datalist>
          <small>{{ 'launch.codexModelHelp' | t }}</small>
          <button type="button" class="btn btn-xs btn-ghost" (click)="refreshModels()" [disabled]="modelsLoading()">{{ modelsLoading() ? '读取模型…' : '刷新模型列表' }}</button>
          @if (modelsError()) { <small role="status">{{ modelsError() }}</small> }
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
        @if (!oneRing()) {
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
        }
      </div>
    </app-launch-dialog-shell>
  `,
  styleUrls: ['./agent-dialog.scss', './launch-dialog.scss'],
})
export class CodexLaunchDialogComponent {
  /** Passed through to the workbench, which owns the settings window. */
  readonly installRequested = output<void>();
  readonly directoryChangeRequested = output<void>();

  /** The agent's own mark, which the heading shows. */
  protected readonly agentIcon = AGENT_ICONS.codex;

  readonly installation = input<AgentInstallation | null>(null);
  readonly profiles = input<ModelProfile[]>([]);
  readonly accountProfiles = input<AccountProfile[]>([]);
  readonly workingDirectory = input('');
  readonly launching = input(false);
  readonly oneRing = input(false);
  readonly launched = output<CodexLaunchDialogValue>();
  readonly cancelled = output<void>();

  private readonly i18n = inject(I18nService);

  protected readonly name = signal('');
  protected readonly model = signal('');
  protected readonly profileId = signal('');
  protected readonly accountProfileId = signal('');
  protected readonly autoConfirm = signal(false);
  private readonly catalogs = inject(CodexModelCatalogService);
  protected readonly modelSuggestions = signal<string[]>([]);
  protected readonly modelsLoading = signal(false);
  protected readonly modelsError = signal('');
  private catalogGeneration = 0;
  protected readonly configuredDefault = signal('');
  protected readonly officialModels = computed(() => {
    const selected = officialModelId(this.resolvedProfileId());
    return [...new Set([...this.modelSuggestions(), ...(selected ? [selected] : [])])];
  });

  constructor() {
    effect(() => { if (this.installation()?.healthy && this.resolvedAccountProfileId()) void this.refreshModels(); });
  }

  protected async refreshModels(): Promise<void> {
    const account = this.resolvedAccountProfileId(), directory = this.workingDirectory();
    const generation = ++this.catalogGeneration;
    this.modelsLoading.set(true); this.modelsError.set(''); this.modelSuggestions.set([]); this.configuredDefault.set('');
    try {
      const catalog = await this.catalogs.load(account, directory, true);
      if (generation !== this.catalogGeneration) return;
      this.modelSuggestions.set(catalog.models.map(model => model.id));
      this.configuredDefault.set(catalog.configuredDefault || catalog.models.find(model => model.isDefault)?.id || '');
    } catch {
      if (generation === this.catalogGeneration) this.modelsError.set('无法读取 CLI 模型列表，可输入模型 ID，或留空沿用 Codex 配置。');
    } finally { if (generation === this.catalogGeneration) this.modelsLoading.set(false); }
  }
  protected readonly effort = signal('');
  protected readonly effortLevels = CODEX_REASONING_EFFORT_LEVELS;
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
      OFFICIAL_MODEL_PREFIX,
  );
  protected readonly resolvedModel = computed(() => {
    const explicit = this.model().trim();
    if (explicit) {
      return explicit;
    }
    const native = officialModelId(this.resolvedProfileId());
    if (native !== undefined) return native;
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
    const native = officialModelId(profileId);
    if (native !== undefined) { this.model.set(native); return; }
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
      profileId: launchProfileId(this.resolvedProfileId()),
      accountProfileId: this.resolvedAccountProfileId() || undefined,
      autoConfirm: this.autoConfirm() || undefined,
      reasoningEffort: this.effort() || undefined,
    });
  }
}
