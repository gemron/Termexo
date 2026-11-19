import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { CodexModelCatalogService } from '../core/services/codex-model-catalog.service';
import { ModelCatalogService } from '../core/services/model-catalog.service';
import {
  CLI_NATIVE_PROFILE_ID,
  matchesRunningModel,
  OFFICIAL_MODEL_PREFIX,
  officialModelId,
} from '../core/models/launch-model-choice';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AgentProtocol,
  ModelProfile,
  needsCredential,
  profileModel,
  profileServes,
} from '../core/models/agent.models';
import { ModalFocusDirective } from '../shared/modal-focus.directive';
import { IconComponent } from '../shared/icon/icon';

export interface ModelSwitchValue {
  profileId: string;
  agent: AgentProtocol;
  model?: string;
}

@Component({
  selector: 'app-model-switch-dialog',
  imports: [FormsModule, ModalFocusDirective, IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="!busy() && cancelled.emit()">
      <section
        class="dialog model-dialog modal-box"
        appModal
        (dismissModal)="!busy() && cancelled.emit()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="model-dialog-title">{{ 'modelSwitch.title' | t }}</h2>
            <p>{{ singleTerminalName() || agentLabel() }}</p>
          </div>
          <button
            type="button"
            class="btn btn-square btn-ghost btn-sm"
            [title]="'common.close' | t"
            [attr.aria-label]="'common.close' | t"
            [disabled]="busy()"
            (click)="cancelled.emit()"
          >
            <app-icon name="x" [size]="15" />
          </button>
        </header>

        <!-- A single-terminal switch has its agent type fixed by that terminal. -->
        @if (!lockedAgentType()) {
          <nav
            class="session-agent-filter tabs tabs-box"
            role="tablist"
            [attr.aria-label]="'session.filterAria' | t"
          >
            <button
              type="button"
              role="tab"
              class="tab"
              [class.active]="agentType() === 'claude'"
              [attr.aria-selected]="agentType() === 'claude'"
              [disabled]="busy()"
              (click)="agentTypeValue.set('claude')"
            >
              {{ 'modelSwitch.claudeTab' | t }}
              <span>{{ claudeCount() }}</span>
            </button>
            <button
              type="button"
              role="tab"
              class="tab"
              [class.active]="agentType() === 'codex'"
              [attr.aria-selected]="agentType() === 'codex'"
              [disabled]="busy()"
              (click)="agentTypeValue.set('codex')"
            >
              {{ 'modelSwitch.codexTab' | t }}
              <span>{{ codexCount() }}</span>
            </button>
          </nav>
        }

        @if (lockedAgentType()) {
          <p class="switch-current">
            {{ 'modelSwitch.current' | t }} ·
            <strong>{{ currentModel() || ('common.defaultModel' | t) }}</strong>
          </p>
        }
        <label>
          <span>{{ 'launch.modelChoice' | t }}</span>
          <select
            class="select select-bordered select-sm"
            [disabled]="busy()"
            [ngModel]="choice()"
            (ngModelChange)="choice.set($event)"
          >
            <option value="" disabled>{{ 'modelSwitch.choose' | t }}</option>
            <optgroup [label]="'launch.officialModels' | t">
              <option [value]="officialPrefix" [disabled]="isCurrent(officialPrefix)">
                {{ 'launch.cliDefaultModel' | t }}
              </option>
              @for (model of officialModels(); track model.id) {
                <option
                  [value]="officialPrefix + model.id"
                  [disabled]="isCurrent(officialPrefix + model.id)"
                >
                  {{ model.name }}
                </option>
              }
            </optgroup>
            @if (filteredProfiles().length) {
              <optgroup [label]="'launch.savedProfiles' | t">
                @for (profile of filteredProfiles(); track profile.id) {
                  <option [value]="profile.id" [disabled]="isCurrent(profile.id)">
                    {{ profile.name }} · {{ modelOf(profile) || ('common.defaultModel' | t) }}
                    @if (missingKey(profile)) {
                      ({{ 'settings.keyRequired' | t }})
                    }
                  </option>
                }
              </optgroup>
            }
          </select>
        </label>
        @if (catalogNotice()) {
          <p class="field-hint" role="status">{{ catalogNotice() | t }}</p>
        }
        <p class="switch-impact">{{ 'modelSwitch.restartHint' | t: { count: targetCount() } }}</p>
        <button
          type="button"
          class="secondary btn btn-sm manage-profile"
          [disabled]="busy()"
          (click)="openSettings()"
        >
          {{ 'settings.manageModels' | t }}
        </button>
        <footer>
          <button
            type="button"
            class="secondary btn btn-ghost btn-sm"
            [disabled]="busy()"
            (click)="cancelled.emit()"
          >
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="!canConfirm()"
            (click)="confirm()"
          >
            {{ (requiresKey() ? 'modelSwitch.addKey' : 'modelSwitch.execute') | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './dialog.scss',
})
export class ModelSwitchDialogComponent {
  private readonly catalog = inject(ModelCatalogService);
  private readonly codexCatalog = inject(CodexModelCatalogService);
  readonly claudeCount = input(0);
  readonly codexCount = input(0);
  readonly profiles = input<ModelProfile[]>([]);
  readonly busy = input(false);
  readonly singleTerminalName = input('');
  readonly lockedAgentType = input<AgentProtocol | null>(null);
  readonly currentProfileId = input('');
  readonly currentModel = input('');
  readonly accountId = input('');
  readonly directory = input('');
  readonly preferredProfileId = input('');
  readonly confirmed = output<ModelSwitchValue>();
  readonly cancelled = output<void>();
  readonly settingsRequested = output<{ profileId: string; choice: string }>();
  protected readonly agentTypeValue = signal<AgentProtocol>('claude');
  readonly agentType = computed(() => this.lockedAgentType() ?? this.agentTypeValue());
  protected readonly agentLabel = computed(() =>
    this.agentType() === 'claude' ? 'Claude Code' : 'Codex CLI',
  );
  protected readonly targetCount = computed(() =>
    this.lockedAgentType()
      ? 1
      : this.agentType() === 'codex'
        ? this.codexCount()
        : this.claudeCount(),
  );
  protected readonly officialPrefix = OFFICIAL_MODEL_PREFIX;
  protected readonly filteredProfiles = computed(() =>
    this.profiles().filter((p) => profileServes(p, this.agentType())),
  );
  protected readonly choice = linkedSignal({
    source: () => ({ preferred: this.preferredProfileId(), agent: this.agentType() }),
    computation: ({ preferred }) => preferred,
  });
  private readonly codexModels = signal<{ id: string; name: string }[]>([]);
  protected readonly catalogNotice = signal('');
  protected readonly officialModels = computed(() =>
    this.agentType() === 'claude'
      ? this.catalog.choices('Anthropic', 'claude')
      : this.codexModels(),
  );
  protected readonly selectedProfile = computed(() =>
    this.filteredProfiles().find((p) => p.id === this.choice()),
  );
  protected readonly settingsProfileId = computed(() => {
    const profiles = this.filteredProfiles();
    return (
      this.selectedProfile()?.id ??
      profiles.find((p) => p.id === this.currentProfileId())?.id ??
      profiles.find((p) => p.isDefault)?.id ??
      profiles[0]?.id ??
      ''
    );
  });
  protected readonly requiresKey = computed(() => {
    const profile = this.selectedProfile();
    return !!profile && this.missingKey(profile);
  });
  protected readonly canConfirm = computed(() => {
    const choice = this.choice();
    if (this.busy() || !this.targetCount() || !choice || this.isCurrent(choice)) return false;
    const native = officialModelId(choice);
    return (
      !!this.selectedProfile() ||
      native === '' ||
      this.officialModels().some((m) => m.id === native)
    );
  });

  constructor() {
    effect((onCleanup) => {
      this.catalogNotice.set('');
      if (this.agentType() !== 'codex') return;
      this.codexModels.set([]);
      // A batch may use different accounts. Only the default is common to all of them.
      if (!this.lockedAgentType()) return;
      let active = true;
      onCleanup(() => {
        active = false;
      });
      this.catalogNotice.set('launch.loadingModels');
      void this.codexCatalog.load(this.accountId(), this.directory()).then(
        (result) => {
          if (!active) return;
          this.codexModels.set(
            result.models.map((m) => ({ id: m.id, name: m.displayName || m.id })),
          );
          this.catalogNotice.set('');
        },
        () => {
          if (active) this.catalogNotice.set('modelSwitch.catalogUnavailable');
        },
      );
    });
  }

  protected isCurrent(choice: string): boolean {
    if (!this.lockedAgentType()) return false;
    const native = officialModelId(choice);
    if (native !== undefined) {
      return matchesRunningModel(
        this.currentProfileId(),
        this.currentModel(),
        CLI_NATIVE_PROFILE_ID,
        native,
      );
    }
    const profile = this.filteredProfiles().find((item) => item.id === choice);
    return (
      !!profile &&
      matchesRunningModel(
        this.currentProfileId(),
        this.currentModel(),
        profile.id,
        this.modelOf(profile),
      )
    );
  }

  protected modelOf(profile: ModelProfile): string {
    return profileModel(profile, this.agentType());
  }

  protected missingKey(profile: ModelProfile): boolean {
    return needsCredential(profile, this.agentType());
  }

  protected openSettings(): void {
    this.settingsRequested.emit({ profileId: this.settingsProfileId(), choice: this.choice() });
  }

  protected confirm(): void {
    if (!this.canConfirm()) return;
    if (this.requiresKey()) {
      this.openSettings();
      return;
    }
    const model = officialModelId(this.choice());
    if (model !== undefined) {
      this.confirmed.emit({
        agent: this.agentType(),
        profileId: CLI_NATIVE_PROFILE_ID,
        model: model || undefined,
      });
    } else {
      this.confirmed.emit({ agent: this.agentType(), profileId: this.choice() });
    }
  }
}
