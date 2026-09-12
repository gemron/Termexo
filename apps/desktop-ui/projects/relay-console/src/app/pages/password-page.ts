import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ConsoleApiService } from '../core/console-api.service';
import { describeConsoleError } from '../core/console-error';
import { registerRelayConsoleTranslations } from '../core/console.i18n';
import { ToastService } from '../core/toast.service';
import { MIN_PASSWORD_LENGTH } from '../shared/password-policy';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';

// Registered at module scope so the wording is in place before the component is built.
registerRelayConsoleTranslations();

@Component({
  selector: 'console-password-page',
  imports: [FormsModule, TranslatePipe],
  template: `
    <header class="page-header">
      <div>
        <h1>{{ 'console.password.title' | t }}</h1>
        <p>{{ 'console.password.subtitle' | t }}</p>
      </div>
    </header>

    <div class="card">
      @if (error()) {
        <div class="alert error" role="alert">{{ error() }}</div>
      }

      <form (ngSubmit)="submit()">
        <div class="field-row">
          <label class="field">
            <span>{{ 'console.password.current' | t }}</span>
            <input
              name="current"
              type="password"
              autocomplete="current-password"
              [disabled]="busy()"
              [ngModel]="current()"
              (ngModelChange)="current.set($event)"
            />
          </label>
        </div>
        <div class="field-row">
          <label class="field">
            <span>{{ 'console.password.new' | t }}</span>
            <input
              name="next"
              type="password"
              autocomplete="new-password"
              [disabled]="busy()"
              [ngModel]="next()"
              (ngModelChange)="next.set($event)"
            />
            @if (tooShort()) {
              <small class="field-error" role="alert">{{ tooShortHint() }}</small>
            }
          </label>
          <label class="field">
            <span>{{ 'console.password.confirm' | t }}</span>
            <input
              name="repeat"
              type="password"
              autocomplete="new-password"
              [disabled]="busy()"
              [ngModel]="repeat()"
              (ngModelChange)="repeat.set($event)"
            />
            @if (mismatch()) {
              <small class="field-error" role="alert">{{ 'console.password.mismatch' | t }}</small>
            }
          </label>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="!canSubmit()">
            {{ (busy() ? 'console.password.submitting' : 'console.password.submit') | t }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class PasswordPageComponent {
  private readonly api = inject(ConsoleApiService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly current = signal('');
  protected readonly next = signal('');
  protected readonly repeat = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly tooShort = computed(
    () => this.next().length > 0 && this.next().length < MIN_PASSWORD_LENGTH,
  );

  protected readonly mismatch = computed(
    () => this.repeat().length > 0 && this.repeat() !== this.next(),
  );

  protected readonly tooShortHint = computed(() =>
    this.i18n.t('console.password.tooShort', { count: MIN_PASSWORD_LENGTH }),
  );

  protected readonly canSubmit = computed(
    () =>
      !this.busy() &&
      this.current().length > 0 &&
      this.next().length >= MIN_PASSWORD_LENGTH &&
      this.repeat() === this.next(),
  );

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.changeOwnPassword(this.current(), this.next());
      // Nothing typed here has any use once the relay accepted it.
      this.current.set('');
      this.next.set('');
      this.repeat.set('');
      this.toasts.success(this.i18n.t('console.password.changed'));
    } catch (error) {
      this.error.set(
        this.i18n.t('console.common.actionFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.busy.set(false);
    }
  }
}
