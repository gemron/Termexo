import { Component, computed, inject, input, output, signal } from '@angular/core';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  AgentProtocol,
  ModelProfile,
  NativeAgentType,
  profileModel,
  profileServes,
} from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

export interface ModelSwitchValue {
  profileId: string;
  agent: AgentProtocol;
}

@Component({
  selector: 'app-model-switch-dialog',
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="backdrop modal modal-open" (mousedown)="cancelled.emit()">
      <section
        class="dialog model-dialog modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-dialog-title"
        (mousedown)="$event.stopPropagation()"
      >
        <header>
          <div>
            <h2 id="model-dialog-title">{{ 'modelSwitch.title' | t }}</h2>
            <p>{{ description() }}</p>
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
              (click)="agentTypeValue.set('codex')"
            >
              {{ 'modelSwitch.codexTab' | t }}
              <span>{{ codexCount() }}</span>
            </button>
          </nav>
        }

        <div class="profile-list">
          @for (profile of filteredProfiles(); track profile.id) {
            <button
              type="button"
              class="profile-option card"
              [class.selected]="profile.id === resolvedProfileId()"
              [class.current]="profile.id === currentProfileId()"
              [disabled]="profile.id === currentProfileId()"
              [attr.aria-current]="profile.id === currentProfileId() ? 'true' : null"
              (click)="selectedProfileId.set(profile.id)"
            >
              <i [style.background]="profileTone(profile.provider)"></i>
              <span
                ><strong>{{ profile.name }}</strong
                ><small>{{ profile.provider }} · {{ modelOf(profile) }}</small></span
              >
              @if (profile.id === currentProfileId()) {
                <span class="current-tag">{{ 'modelSwitch.current' | t }}</span>
              } @else if (profile.id === resolvedProfileId()) {
                <app-icon name="check" [size]="15" />
              }
            </button>
          } @empty {
            <div class="dialog-empty">
              <strong>{{ emptyTitle() }}</strong>
              <span>{{ emptyDescription() }}</span>
            </div>
          }
        </div>
        <div class="switch-plan">
          <div>
            <strong>{{ 'modelSwitch.cliUnchanged' | t }}</strong><span>CLI {{ agentType() === 'codex' ? 'Codex CLI' : 'Claude Code' }}</span>
          </div>
          <div>
            <strong>{{ singleTerminalName() ? 1 : agentCount() }}</strong
            ><span>{{ 'modelSwitch.terminalsRestart' | t }}</span>
          </div>
          <div>
            <strong>{{ 'modelSwitch.newSession' | t }}</strong
            ><span>{{ 'modelSwitch.newSessionHelp' | t }}</span>
          </div>
        </div>
        <footer>
          <button type="button" class="secondary btn btn-ghost btn-sm" (click)="cancelled.emit()">
            {{ 'common.cancel' | t }}
          </button>
          <button
            type="button"
            class="primary btn btn-primary btn-sm"
            [disabled]="busy() || !resolvedProfileId()"
            (click)="confirm()"
          >
            {{ 'modelSwitch.execute' | t }}
          </button>
        </footer>
      </section>
    </div>
  `,
  styleUrl: './dialog.scss',
})
export class ModelSwitchDialogComponent {
  private readonly i18nService = inject(I18nService);
  readonly agentCount = input(0);
  readonly claudeCount = input(0);
  readonly codexCount = input(0);
  readonly profiles = input<ModelProfile[]>([]);
  readonly busy = input(false);
  /** Name of the single terminal being switched; empty for a batch switch. */
  readonly singleTerminalName = input('');
  /** Fixes the agent type, hiding the tabs when the target terminal already decides it. */
  readonly lockedAgentType = input<NativeAgentType | null>(null);
  /** Profile already running in a single terminal; it remains visible but cannot be selected. */
  readonly currentProfileId = input('');
  readonly confirmed = output<ModelSwitchValue>();
  readonly cancelled = output<void>();
  readonly selectedProfileId = signal('');
  protected readonly agentTypeValue = signal<NativeAgentType>('claude');
  readonly agentType = computed(() => this.lockedAgentType() ?? this.agentTypeValue());
  protected readonly selectedAgent = computed<AgentProtocol>(() =>
    this.agentType() === 'codex' ? 'codex' : 'claude',
  );

  /** Only profiles switched on for the agent being changed can be offered. */
  protected readonly filteredProfiles = computed(() =>
    this.profiles().filter((profile) => profileServes(profile, this.selectedAgent())),
  );
  protected readonly switchableProfiles = computed(() =>
    this.filteredProfiles().filter((profile) => profile.id !== this.currentProfileId()),
  );
  protected readonly resolvedProfileId = computed(() => {
    const profiles = this.switchableProfiles();
    const selected = this.selectedProfileId();
    return (
      profiles.find((profile) => profile.id === selected)?.id ||
      profiles.find((profile) => profile.isDefault)?.id ||
      profiles[0]?.id ||
      ''
    );
  });
  protected readonly description = computed(() => {
    // A single-terminal switch names the terminal, so the scope is unmistakable.
    const name = this.singleTerminalName();
    if (name) {
      return this.i18nService.t('terminal.switchOneTitle', { name });
    }
    return this.agentType() === 'codex'
      ? this.i18n('modelSwitch.codexDescription')
      : this.i18n('modelSwitch.description');
  });
  protected readonly emptyTitle = computed(() => {
    if (this.agentType() === 'codex') {
      return this.i18n('modelSwitch.codexEmpty');
    }
    return this.i18n('modelSwitch.empty');
  });
  protected readonly emptyDescription = computed(() => {
    if (this.agentType() === 'codex') {
      return this.i18n('modelSwitch.codexEmptyHelp');
    }
    return this.i18n('modelSwitch.emptyHelp');
  });

  protected confirm(): void {
    const profileId = this.resolvedProfileId();
    if (!profileId) {
      return;
    }
    this.confirmed.emit({ profileId, agent: this.selectedAgent() });
  }

  protected modelOf(profile: ModelProfile): string {
    return profileModel(profile, this.selectedAgent());
  }

  protected profileTone(provider: string): string {
    const tones: Record<string, string> = {
      Anthropic: '#d97757',
      ChatGPT: '#10a37f',
      DeepSeek: '#4d6bfe',
      MiniMax: '#7f68dc',
      GLM: '#58c7a0',
    };
    return tones[provider] ?? '#68a9e8';
  }

  private i18n(key: string): string {
    return this.i18nService.t(key);
  }
}
