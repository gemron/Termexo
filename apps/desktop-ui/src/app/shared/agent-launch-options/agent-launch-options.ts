import { Component, computed, inject, input, output } from '@angular/core';

import { I18nService } from '../../core/i18n/i18n.service';
import { AgentInstallation, ManagedAgentType } from '../../core/models/agent.models';
import { AGENT_ICONS, AGENT_LABELS, AgentType } from '../../core/models/workspace.models';
import { agentReadiness, AgentService } from '../../core/services/agent.service';
import { hasBackend } from '../../core/services/tauri-runtime';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { IconComponent } from '../icon/icon';

/**
 * `menu` sits inside the tab strip's dropdown; `panel` stands on its own in the empty workspace
 * and therefore brings its own frame.
 */
export type AgentLaunchOptionsVariant = 'menu' | 'panel';

interface AgentLaunchOption {
  readonly type: AgentType;
  readonly title: string;
  readonly hint: string;
  readonly icon: string;
  readonly tone: string;
}

interface AgentLaunchGroup {
  readonly title: string;
  readonly options: AgentLaunchOption[];
}

@Component({
  selector: 'app-agent-launch-options',
  imports: [IconComponent, TranslatePipe],
  template: `
    <div class="launch-options" [attr.data-variant]="variant()">
      @for (group of groups(); track group.title) {
        <p class="menu-group">{{ group.title }}</p>
        @for (option of group.options; track option.type) {
          <button
            type="button"
            [attr.role]="variant() === 'menu' ? 'menuitem' : null"
            [attr.data-agent]="option.type"
            (click)="optionSelected.emit(option.type)"
          >
            <span [attr.data-tone]="option.tone"
              ><app-icon [name]="option.icon" [size]="14"
            /></span>
            <div>
              <strong>{{ option.title }}</strong>
              @if (option.hint) {
                <small>{{ option.hint }}</small>
              }
            </div>
          </button>
        }
      }
      @if (includePreview()) {
        <button
          type="button"
          [attr.role]="variant() === 'menu' ? 'menuitem' : null"
          data-action="preview"
          (click)="previewRequested.emit()"
        >
          <span data-tone="slate"><app-icon name="folder" [size]="14" /></span>
          <div>
            <strong>{{ 'terminal.openPreview' | t }}</strong
            ><small>{{ 'terminal.previewHint' | t }}</small>
          </div>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .launch-options[data-variant='panel'] {
      width: 244px;
      padding: 5px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-box);
      background: var(--surface-raised);
      text-align: left;
    }

    button {
      display: grid;
      width: 100%;
      grid-template-columns: 28px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      padding: 8px;
      border: 0;
      border-radius: var(--radius-field);
      color: var(--text-secondary);
      text-align: left;
      background: transparent;
    }

    button:hover,
    button:focus-visible {
      color: var(--text);
      background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
    }

    button > span {
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border-radius: var(--radius-selector);
    }

    button > span[data-tone='green'] {
      color: var(--color-primary);
      background: var(--primary-soft);
    }

    button > span[data-tone='blue'] {
      color: var(--color-info);
      background: var(--info-soft);
    }

    button > span[data-tone='amber'] {
      color: var(--color-warning);
      background: var(--warning-soft);
    }

    button > span[data-tone='purple'] {
      color: var(--color-secondary);
      background: var(--secondary-soft);
    }

    /* A plain shell carries no Agent identity, so it stays neutral against the coloured ones. */
    button > span[data-tone='slate'] {
      color: var(--text-secondary);
      background: var(--surface-2);
    }

    strong,
    small {
      display: block;
    }

    strong {
      overflow-wrap: anywhere;
      font-size: 12px;
      font-weight: 620;
    }

    small {
      overflow-wrap: anywhere;
      margin-top: 3px;
      color: var(--text-muted);
      font: 11px/1.35 var(--sans);
    }

    /* Separates the plain terminal from the Agents without spending a divider rule on it. */
    .menu-group {
      padding: 7px 7px 4px;
      margin: 0;
      color: var(--text-muted);
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    button + .menu-group {
      padding-top: 8px;
      border-top: 1px solid var(--border);
      margin-top: 3px;
    }
  `,
})
export class AgentLaunchOptionsComponent {
  private readonly agents = inject(AgentService);
  private readonly i18n = inject(I18nService);
  private readonly preview = !hasBackend();

  readonly variant = input<AgentLaunchOptionsVariant>('menu');
  readonly includePreview = input(false);
  readonly previewRequested = output<void>();
  readonly optionSelected = output<AgentType>();

  protected readonly groups = computed<AgentLaunchGroup[]>(() => {
    const installations: Record<ManagedAgentType, AgentInstallation | null> = {
      claude: this.agents.installation(),
      codex: this.agents.codexInstallation(),
      opencode: this.agents.openCodeInstallation(),
      pi: this.agents.piInstallation(),
      grok: this.agents.grokInstallation(),
      antigravity: this.agents.antigravityInstallation(),
    };
    const tones: Record<ManagedAgentType, string> = {
      claude: 'green',
      codex: 'blue',
      opencode: 'amber',
      pi: 'purple',
      grok: 'blue',
      antigravity: 'purple',
    };
    const agents = (Object.keys(installations) as ManagedAgentType[])
      .map((type) => {
        const installation = installations[type];
        const detection = this.agents.detectionStates()[type];
        const status = agentReadiness(installation, detection);
        const hint = this.preview ? '' : this.i18n.t('launcher.' + status);
        return {
          type,
          title: AGENT_LABELS[type],
          icon: AGENT_ICONS[type],
          tone: tones[type],
          ready: status === 'ready',
          hint:
            hint && status === 'ready' && installation?.version
              ? hint + ' · ' + installation.version
              : hint,
        };
      })
      .sort((a, b) => Number(b.ready) - Number(a.ready));

    return [
      {
        title: this.i18n.t(this.preview ? 'launcher.previewGroup' : 'terminal.groupAgent'),
        options: agents,
      },
      {
        title: this.i18n.t('terminal.groupTerminal'),
        options: [
          {
            type: 'shell',
            title: this.i18n.t('terminal.plainShell'),
            hint: this.i18n.t('terminal.shellHint'),
            icon: AGENT_ICONS.shell,
            tone: 'slate',
          },
        ],
      },
    ];
  });
}
