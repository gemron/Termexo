import { Component, computed, inject } from '@angular/core';

import { I18nService } from '../core/i18n/i18n.service';
import { registerRemoteTranslations } from '../core/i18n/remote.i18n';
import { RemoteConnectionService } from '../core/services/remote-connection.service';

registerRemoteTranslations();

/** Label key per connection state, so the badge and its tooltip stay in step. */
const STATE_LABELS: Readonly<Record<string, string>> = {
  ready: 'common.connected',
  connecting: 'remote.badgeConnecting',
  authenticating: 'remote.badgeAuthenticating',
  reconnecting: 'remote.badgeReconnecting',
  unauthorized: 'remote.badgeUnauthorized',
  idle: 'common.notConnected',
};

/**
 * Connection state of the remote client, in the topbar.
 *
 * A remote page looks exactly like the desktop one, so this is the only standing reminder that
 * the terminals live on another machine — and the first place to look when input stops landing.
 */
@Component({
  selector: 'app-remote-connection-badge',
  template: `
    <span class="remote-badge" [attr.data-state]="connection.state()" [title]="tooltip()">
      <i aria-hidden="true"></i>
      <span>{{ label() }}</span>
    </span>
  `,
  styleUrl: './remote-connection-badge.scss',
})
export class RemoteConnectionBadgeComponent {
  protected readonly connection = inject(RemoteConnectionService);
  private readonly i18n = inject(I18nService);

  protected readonly label = computed(() =>
    this.i18n.t(STATE_LABELS[this.connection.state()] ?? 'common.notConnected'),
  );

  protected readonly tooltip = computed(
    () => this.connection.error() ?? this.i18n.t('remote.badgeHint', { state: this.label() }),
  );
}
