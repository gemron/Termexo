import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { describeConsoleError } from '../core/console-error';
import { registerRelayConsoleTranslations } from '../core/console.i18n';
import { SessionService } from '../core/session.service';
import { OPEN_RELAY_ADDRESS, safeNextTarget } from '../shared/next-target';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';

// Registered at module scope so the wording is in place before the component is built.
registerRelayConsoleTranslations();

/** The query parameter the relay puts the interrupted device address in. */
const NEXT_PARAMETER = 'next';

@Component({
  selector: 'console-login-page',
  imports: [FormsModule, TranslatePipe],
  template: `
    <div class="login-page">
      <form class="login-card" (ngSubmit)="submit()">
        <h1>{{ 'console.login.title' | t }}</h1>
        <p>{{ subtitle() | t }}</p>

        @if (error()) {
          <div class="alert error" role="alert">{{ error() }}</div>
        }

        <label class="field">
          <span>{{ 'console.login.username' | t }}</span>
          <input
            name="username"
            type="text"
            autocomplete="username"
            spellcheck="false"
            autofocus
            [disabled]="busy()"
            [ngModel]="username()"
            (ngModelChange)="username.set($event)"
          />
        </label>
        <label class="field">
          <span>{{ 'console.login.password' | t }}</span>
          <input
            name="password"
            type="password"
            autocomplete="current-password"
            [disabled]="busy()"
            [ngModel]="password()"
            (ngModelChange)="password.set($event)"
          />
        </label>

        <button type="submit" class="btn btn-primary" [disabled]="!canSubmit()">
          {{ (busy() ? 'console.login.submitting' : 'console.login.submit') | t }}
        </button>
      </form>
    </div>
  `,
})
export class LoginPageComponent {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly openRelayAddress = inject(OPEN_RELAY_ADDRESS);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  /**
   * Where the relay wants the browser to end up, when it sent it here from a restricted device
   * address. Read once: the form does not navigate, so the parameter cannot change underneath it.
   */
  private readonly nextTarget = safeNextTarget(
    this.route.snapshot.queryParamMap.get(NEXT_PARAMETER),
  );

  /** Saying why the login page appeared is what makes an unexpected redirect understandable. */
  protected readonly subtitle = computed(() =>
    this.nextTarget ? 'console.login.subtitleDevice' : 'console.login.subtitle',
  );

  protected readonly canSubmit = computed(
    () => !this.busy() && this.username().trim().length > 0 && this.password().length > 0,
  );

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.session.signIn(this.username().trim(), this.password());
      // The password has done its one job; it must not sit in memory behind the next page.
      this.password.set('');
      await this.openNextPage();
    } catch (error) {
      this.error.set(this.i18n.t('console.login.failed', { error: describeConsoleError(error) }));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * A device address is served by the relay, not by this application, so it is opened as a
   * document rather than routed to; only the console's own pages go through the router.
   */
  private async openNextPage(): Promise<void> {
    if (this.nextTarget) {
      this.openRelayAddress(this.nextTarget);
      return;
    }
    await this.router.navigate(['/']);
  }
}
