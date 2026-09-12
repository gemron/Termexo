import { Component, inject, signal } from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { AntigravityStatusFeed } from '../core/models/agent.models';
import { AGENT_ICONS } from '../core/models/workspace.models';
import { AgentService } from '../core/services/agent.service';
import { IconComponent } from '../shared/icon/icon';

/**
 * Turns Antigravity's state reporting on and off.
 *
 * Every other agent Termexo drives can be configured for a single launch. Antigravity cannot, so
 * the only way to see what its agent is doing is a status-line command written into the settings
 * file its own installation reads — the one file Termexo edits that it does not own. That makes it
 * a switch the user throws deliberately rather than something a launch does on their behalf, and
 * turning it off puts back whatever was configured before.
 */
@Component({
  selector: 'app-antigravity-status-toggle',
  imports: [IconComponent, TranslatePipe],
  template: `
    @if (feed(); as status) {
      <div class="diagnostic-status alert" [class.unavailable]="!status.installed">
        <span><app-icon [name]="agentIcon" [size]="18" /></span>
        <div>
          <strong>{{ 'settings.antigravityStatus' | t }}</strong>
          <small>{{
            status.installed
              ? ('settings.antigravityStatusOn' | t)
              : ('settings.antigravityStatusOff' | t)
          }}</small>
          @if (status.foreignStatusLine && !status.installed) {
            <small>{{ 'settings.antigravityStatusForeign' | t }}</small>
          }
          <small class="status-feed-path">
            {{ 'settings.antigravityStatusFile' | t }}: {{ status.settingsPath }}
          </small>
        </div>
        <button
          type="button"
          class="btn btn-sm"
          [class.btn-primary]="!status.installed"
          [class.btn-ghost]="status.installed"
          [disabled]="busy()"
          (click)="toggle(!status.installed)"
        >
          {{ status.installed ? ('common.disable' | t) : ('common.enable' | t) }}
        </button>
      </div>
      <p class="status-feed-help">{{ 'settings.antigravityStatusHelp' | t }}</p>
      @if (error(); as message) {
        <p class="status-feed-help">{{ message }}</p>
      }
    }
  `,
  styles: `
    .status-feed-path {
      overflow-wrap: anywhere;
      opacity: 0.75;
    }

    .status-feed-help {
      margin: 6px 0 0;
      font-size: 11px;
      line-height: 1.6;
      color: var(--text-muted);
    }
  `,
})
export class AntigravityStatusToggleComponent {
  /** The agent's own mark, which the heading shows. */
  protected readonly agentIcon = AGENT_ICONS.antigravity;

  private readonly agents = inject(AgentService);

  protected readonly feed = signal<AntigravityStatusFeed | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.refresh();
  }

  protected async toggle(enabled: boolean): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.feed.set(await this.agents.setAntigravityStatusFeed(enabled));
    } catch (error) {
      this.error.set(typeof error === 'string' ? error : String(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async refresh(): Promise<void> {
    try {
      this.feed.set(await this.agents.readAntigravityStatusFeed());
    } catch (error) {
      this.error.set(typeof error === 'string' ? error : String(error));
    }
  }
}
