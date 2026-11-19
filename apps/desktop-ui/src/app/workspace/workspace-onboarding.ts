import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output } from '@angular/core';

import { registerOnboardingTranslations } from '../core/i18n/onboarding.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { type AgentInstallation, type ManagedAgentType } from '../core/models/agent.models';
import {
  AGENT_ICONS,
  AGENT_LABELS,
  type AgentType,
  type Workspace,
} from '../core/models/workspace.models';
import { agentReadiness, AgentService } from '../core/services/agent.service';
import { hasBackend, isTauriRuntime } from '../core/services/tauri-runtime';
import { IconComponent } from '../shared/icon/icon';

registerOnboardingTranslations();

@Component({
  selector: 'app-workspace-onboarding',
  imports: [IconComponent, NgTemplateOutlet, TranslatePipe],
  templateUrl: './workspace-onboarding.html',
  styleUrl: './workspace-onboarding.scss',
})
export class WorkspaceOnboardingComponent {
  protected readonly agents = inject(AgentService);
  protected readonly desktop = isTauriRuntime();
  protected readonly preview = !hasBackend();

  readonly workspace = input<Pick<Workspace, 'name' | 'projectPath'> | null>(null);
  readonly createRequested = output<void>();
  readonly launchRequested = output<AgentType>();
  readonly installRequested = output<ManagedAgentType>();

  protected readonly agentRows = computed(() => {
    const installations: Record<ManagedAgentType, AgentInstallation | null> = {
      claude: this.agents.installation(),
      codex: this.agents.codexInstallation(),
      opencode: this.agents.openCodeInstallation(),
      grok: this.agents.grokInstallation(),
      pi: this.agents.piInstallation(),
      antigravity: this.agents.antigravityInstallation(),
    };
    return (Object.keys(installations) as ManagedAgentType[])
      .map((type) => {
        const installation = installations[type];
        const detection = this.agents.detectionStates()[type];
        const status = agentReadiness(installation, detection);
        return {
          type,
          name: AGENT_LABELS[type],
          icon: AGENT_ICONS[type],
          status,
          version: installation?.version,
          detail:
            detection?.status === 'error'
              ? detection.message
              : status === 'unhealthy'
                ? installation?.diagnostic
                : null,
        };
      })
      .sort((left, right) => Number(right.status === 'ready') - Number(left.status === 'ready'));
  });
  protected readonly readyRows = computed(() =>
    this.agentRows().filter((row) => row.status === 'ready'),
  );
  protected readonly otherRows = computed(() =>
    this.agentRows().filter((row) => row.status !== 'ready'),
  );
  protected readonly checking = computed(() =>
    this.agentRows().some((row) => row.status === 'checking'),
  );

  protected launch(type: ManagedAgentType): void {
    if (this.agentRows().some((row) => row.type === type && row.status === 'ready')) {
      this.launchRequested.emit(type);
    }
  }
}
