import { Component, inject, output } from '@angular/core';

import { registerRemoteHostsTranslations } from '../core/i18n/remote-hosts.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { RemoteHostsService } from '../core/services/remote-hosts.service';
import { IconComponent } from './icon/icon';

registerRemoteHostsTranslations();

@Component({
  selector: 'app-remote-hosts-button',
  imports: [IconComponent, TranslatePipe],
  template: `
    <button
      type="button"
      data-testid="remote-hosts-open"
      [title]="'remoteHosts.buttonHint' | t"
      (click)="opened.emit()"
    >
      <app-icon name="server" [size]="14" />
      <span>{{ 'remoteHosts.button' | t }}</span>
      @if (remoteHosts.hosts().length > 0) {
        <em [class.online]="remoteHosts.onlineCount() > 0">
          {{ remoteHosts.onlineCount() }}/{{ remoteHosts.hosts().length }}
        </em>
      }
    </button>
  `,
  styles: `
    button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 0 8px;
      border: 0;
      border-radius: 3px;
      color: var(--text-secondary);
      background: transparent;
      font-size: 11px;
      white-space: nowrap;
    }

    button:hover,
    button:focus-visible {
      color: var(--text);
      background: var(--surface-2);
    }

    em {
      padding: 1px 5px;
      border-radius: 999px;
      color: var(--text-muted);
      background: var(--surface-2);
      font: 10px/1.2 var(--mono);
      font-style: normal;
    }

    em.online {
      color: var(--color-success, #22c55e);
      background: color-mix(in oklab, var(--color-success, #22c55e) 16%, transparent);
    }
  `,
})
export class RemoteHostsButtonComponent {
  protected readonly remoteHosts = inject(RemoteHostsService);
  readonly opened = output<void>();

  constructor() {
    void this.remoteHosts.ensureLoaded();
  }
}
