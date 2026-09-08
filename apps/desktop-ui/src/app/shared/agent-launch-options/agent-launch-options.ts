import { Component, computed, inject, input, output } from '@angular/core';

import { I18nService } from '../../core/i18n/i18n.service';
import { AgentInstallation } from '../../core/models/agent.models';
import { AgentType } from '../../core/models/workspace.models';
import { AgentService } from '../../core/services/agent.service';
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

/**
 * Everything a workspace can open, in one list.
 *
 * Shared by the tab strip's new-terminal menu and the empty workspace, so a workspace with no
 * terminals offers the same three Agents as one that already has tabs — its button used to open a
 * plain Shell and left starting an Agent to a menu the user had not found yet.
 */
@Component({
  selector: 'app-agent-launch-options',
  imports: [IconComponent],
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
              <small>{{ option.hint }}</small>
            </div>
          </button>
        }
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
      padding: 7px;
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
      outline: 0;
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

    /* A plain shell carries no Agent identity, so it stays neutral against the coloured three. */
    button > span[data-tone='slate'] {
      color: var(--text-secondary);
      background: var(--surface-2);
    }

    strong,
    small {
      display: block;
    }

    strong {
      font-size: 11px;
      font-weight: 620;
    }

    small {
      margin-top: 3px;
      color: var(--text-muted);
      font: 9px/1.25 var(--mono);
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

  readonly variant = input<AgentLaunchOptionsVariant>('menu');
  readonly optionSelected = output<AgentType>();

  protected readonly groups = computed<AgentLaunchGroup[]>(() => [
    {
      title: this.i18n.t('terminal.groupAgent'),
      options: [
        {
          type: 'claude',
          title: 'Claude Code',
          hint: this.installationLabel(this.agents.installation()),
          icon: 'bot',
          tone: 'green',
        },
        {
          type: 'codex',
          title: 'Codex CLI',
          hint: this.installationLabel(this.agents.codexInstallation()),
          icon: 'bot',
          tone: 'blue',
        },
        {
          type: 'opencode',
          title: 'OpenCode',
          hint: this.installationLabel(this.agents.openCodeInstallation()),
          icon: 'terminal',
          tone: 'amber',
        },
      ],
    },
    {
      title: this.i18n.t('terminal.groupTerminal'),
      options: [
        {
          type: 'shell',
          title: 'Shell',
          hint: this.i18n.t('terminal.shellHint'),
          icon: 'terminal',
          tone: 'slate',
        },
      ],
    },
  ]);

  /**
   * What each Agent shows under its name: its version when the CLI is usable, and otherwise why it
   * is not. One reading for all three, so a missing CLI is visible before the user picks it rather
   * than after the launch dialog opens.
   */
  private installationLabel(installation: AgentInstallation | null): string {
    if (!installation?.healthy) {
      return this.i18n.t('common.notDetected');
    }
    return installation.version ?? this.i18n.t('common.connected');
  }
}
