import { Component, computed, inject, input, output, signal } from '@angular/core';

import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { ModelProfile, NativeAgentType } from '../core/models/agent.models';
import { IconComponent } from '../shared/icon/icon';

export interface ModelSwitchValue {
  profileId: string;
  apiProtocol: 'anthropic' | 'openai';
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

        <nav class="session-agent-filter tabs tabs-box" role="tablist" [attr.aria-label]="'session.filterAria' | t">
          <button
            type="button"
            role="tab"
            class="tab"
            [class.active]="agentType() === 'claude'"
            [attr.aria-selected]="agentType() === 'claude'"
            (click)="agentType.set('claude')"
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
            (click)="agentType.set('codex')"
          >
            {{ 'modelSwitch.codexTab' | t }}
            <span>{{ codexCount() }}</span>
          </button>
        </nav>

        <div class="profile-list">
          @for (profile of filteredProfiles(); track profile.id) {
            <button
              type="button"
              class="profile-option card"
              [class.selected]="profile.id === resolvedProfileId()"
              (click)="selectedProfileId.set(profile.id)"
            >
              <i [style.background]="profileTone(profile.provider)"></i>
              <span
                ><strong>{{ profile.name }}</strong
                ><small>{{ profile.provider }} · {{ profile.model }}</small></span
              >
              @if (profile.id === resolvedProfileId()) {
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
            <strong>{{ agentCount() }}</strong
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
  readonly confirmed = output<ModelSwitchValue>();
  readonly cancelled = output<void>();
  readonly selectedProfileId = signal('');
  readonly agentType = signal<NativeAgentType>('claude');

  protected readonly anthropicProfiles = computed(() =>
    this.profiles().filter((profile) => profile.apiProtocol === 'anthropic'),
  );
  protected readonly openaiProfiles = computed(() =>
    this.profiles().filter((profile) => profile.apiProtocol === 'openai'),
  );
  protected readonly filteredProfiles = computed(() =>
    this.agentType() === 'codex' ? this.openaiProfiles() : this.anthropicProfiles(),
  );
  protected readonly resolvedProfileId = computed(
    () =>
      this.selectedProfileId() ||
      this.filteredProfiles().find((profile) => profile.isDefault)?.id ||
      this.filteredProfiles()[0]?.id ||
      '',
  );
  protected readonly description = computed(() =>
    this.agentType() === 'codex'
      ? this.i18n('modelSwitch.codexDescription')
      : this.i18n('modelSwitch.description'),
  );
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
    const profile = this.filteredProfiles().find((p) => p.id === profileId);
    this.confirmed.emit({
      profileId,
      apiProtocol: profile?.apiProtocol ?? 'anthropic',
    });
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