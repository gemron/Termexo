import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { I18nService } from '../core/i18n/i18n.service';
import { registerRemoteTranslations } from '../core/i18n/remote.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { RemoteConnectionService } from '../core/services/remote-connection.service';
import { IconComponent } from '../shared/icon/icon';

registerRemoteTranslations();

/**
 * Full-screen gate shown while the remote client is not usable yet.
 *
 * Nothing behind it can be trusted until the socket is authenticated — the workspace list would
 * be empty and every action would fail — so the gate covers the whole app instead of appearing
 * as a toast, and it disappears the moment the connection is ready.
 */
@Component({
  selector: 'app-remote-access-gate',
  imports: [FormsModule, IconComponent, TranslatePipe],
  template: `
    @if (connection.state() !== 'ready') {
      <div class="remote-gate" role="dialog" aria-modal="true" aria-labelledby="remote-gate-title">
        <section class="remote-gate-card">
          <span class="remote-gate-icon"><app-icon name="devices" [size]="20" /></span>
          <h2 id="remote-gate-title">{{ 'remote.gateTitle' | t }}</h2>
          <p class="remote-gate-status">{{ statusText() }}</p>

          @if (connection.error(); as message) {
            <p class="remote-gate-error" role="alert">{{ message }}</p>
          }

          @if (connection.state() === 'unauthorized') {
            <form class="remote-gate-form" (ngSubmit)="submit()">
              <label>
                <span>{{ 'remote.gateTokenLabel' | t }}</span>
                <input
                  #tokenField
                  name="token"
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  [placeholder]="'remote.gateTokenPlaceholder' | t"
                  [ngModel]="token()"
                  (ngModelChange)="token.set($event)"
                />
              </label>
              <small>{{ 'remote.gateTokenHint' | t }}</small>
              <div class="remote-gate-actions">
                <span></span>
                <button type="submit" class="remote-gate-submit" [disabled]="!token().trim()">
                  {{ 'remote.gateConnect' | t }}
                </button>
              </div>
            </form>
          } @else {
            <div class="remote-gate-progress" aria-hidden="true"><i></i></div>
            <!-- The only way out of a connect loop caused by a token this server no longer accepts. -->
            @if (connection.hasStoredToken()) {
              <button type="button" class="remote-gate-forget" (click)="connection.forget()">
                {{ 'remote.gateForget' | t }}
              </button>
            }
          }
        </section>
      </div>
    }
  `,
  styleUrl: './remote-access-gate.scss',
})
export class RemoteAccessGateComponent {
  protected readonly connection = inject(RemoteConnectionService);
  private readonly i18n = inject(I18nService);
  private readonly tokenField = viewChild<ElementRef<HTMLInputElement>>('tokenField');

  protected readonly token = signal('');

  protected readonly statusText = computed(() => {
    switch (this.connection.state()) {
      case 'connecting':
        return this.i18n.t('remote.gateConnecting');
      case 'authenticating':
        return this.i18n.t('remote.gateAuthenticating');
      case 'reconnecting':
        return this.i18n.t('remote.gateReconnecting');
      case 'unauthorized':
        return this.i18n.t('remote.gateUnauthorized');
      default:
        return this.i18n.t('remote.gateIdle');
    }
  });

  constructor() {
    // The token field is the only thing left to do when the gate asks for one, so it takes focus.
    effect(() => this.tokenField()?.nativeElement.focus());
  }

  protected submit(): void {
    const token = this.token().trim();
    if (!token) return;
    this.token.set('');
    this.connection.submitToken(token);
  }
}
