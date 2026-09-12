import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { NewUser, UserRole, UserView } from '../core/console.models';
import { ConfirmBlockComponent } from '../shared/confirm-block';
import { DrawerComponent } from '../shared/drawer';
import { formatMoment } from '../shared/format';
import { MIN_PASSWORD_LENGTH } from '../shared/password-policy';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';

/** What the drawer hands back; `password` is absent when it should stay as it is. */
export interface UserDraft {
  username: string;
  role: UserRole;
  disabled: boolean;
  password?: string;
}

/** Creates a user or edits one — the same three fields either way. */
@Component({
  selector: 'console-user-drawer',
  imports: [ConfirmBlockComponent, DrawerComponent, FormsModule, TranslatePipe],
  template: `
    <console-drawer [heading]="heading()" (closed)="closed.emit()">
      @if (user(); as existing) {
        <dl class="facts">
          <div>
            <dt>{{ 'console.users.createdAt' | t }}</dt>
            <dd>{{ moment(existing.createdAt) }}</dd>
          </div>
          <div>
            <dt>{{ 'console.users.lastLogin' | t }}</dt>
            <dd>{{ existing.lastLoginAt ? moment(existing.lastLoginAt) : neverLabel() }}</dd>
          </div>
          <div>
            <dt>{{ 'console.users.devices' | t }}</dt>
            <dd>{{ existing.deviceCount }}</dd>
          </div>
        </dl>
      }

      @if (error()) {
        <div class="alert error" role="alert">{{ error() }}</div>
      }

      <form (ngSubmit)="submit()">
        <div class="field-row">
          <label class="field">
            <span>{{ 'console.users.username' | t }}</span>
            <input
              name="username"
              type="text"
              autocomplete="off"
              spellcheck="false"
              [disabled]="busy() || isEditing()"
              [ngModel]="username()"
              (ngModelChange)="username.set($event)"
            />
            @if (usernameInvalid()) {
              <small class="field-error" role="alert">
                {{ 'console.users.usernameRequired' | t }}
              </small>
            }
          </label>
          <label class="field">
            <span>{{ 'console.users.role' | t }}</span>
            <select
              name="role"
              [disabled]="busy()"
              [ngModel]="role()"
              (ngModelChange)="role.set($event)"
            >
              <option value="user">{{ 'console.role.user' | t }}</option>
              <option value="admin">{{ 'console.role.admin' | t }}</option>
            </select>
          </label>
        </div>

        <div class="field-row">
          <label class="field">
            <span>{{
              (isEditing() ? 'console.users.newPassword' : 'console.users.password') | t
            }}</span>
            <input
              name="password"
              type="password"
              autocomplete="new-password"
              [disabled]="busy()"
              [ngModel]="password()"
              (ngModelChange)="password.set($event)"
            />
            @if (passwordInvalid()) {
              <small class="field-error" role="alert">{{ passwordHint() }}</small>
            } @else if (isEditing()) {
              <small>{{ 'console.users.newPasswordHint' | t }}</small>
            }
          </label>
        </div>

        @if (isEditing()) {
          <label class="checkbox-field">
            <input
              name="disabled"
              type="checkbox"
              [disabled]="busy()"
              [ngModel]="disabled()"
              (ngModelChange)="disabled.set($event)"
            />
            <span>{{ 'console.users.disableField' | t }}</span>
          </label>
          <small>{{ 'console.users.disableHint' | t }}</small>
        }

        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="!canSubmit()">
            {{ (busy() ? 'console.common.saving' : 'console.common.save') | t }}
          </button>
        </div>
      </form>

      @if (isEditing()) {
        @if (confirmingDelete()) {
          <console-confirm
            [message]="deleteMessage()"
            [confirmLabel]="'console.users.deleteAction' | t"
            [busy]="busy()"
            (confirmed)="deleted.emit()"
            (cancelled)="confirmingDelete.set(false)"
          />
        } @else {
          <div class="form-actions">
            <button
              type="button"
              class="btn btn-danger"
              [disabled]="busy()"
              (click)="confirmingDelete.set(true)"
            >
              {{ 'console.users.delete' | t }}
            </button>
          </div>
        }
      }
    </console-drawer>
  `,
})
export class UserDrawerComponent {
  private readonly i18n = inject(I18nService);

  /** Null while creating a user; the existing record while editing one. */
  readonly user = input<UserView | null>(null);
  readonly busy = input(false);
  readonly error = input('');

  readonly closed = output<void>();
  readonly submitted = output<UserDraft>();
  readonly deleted = output<void>();

  protected readonly username = signal('');
  protected readonly role = signal<UserRole>('user');
  protected readonly password = signal('');
  protected readonly disabled = signal(false);
  protected readonly confirmingDelete = signal(false);

  protected readonly isEditing = computed(() => this.user() !== null);

  protected readonly heading = computed(() =>
    this.i18n.t(this.isEditing() ? 'console.users.editTitle' : 'console.users.createTitle'),
  );

  protected readonly usernameInvalid = computed(() => this.username().trim().length === 0);

  /** A new user needs a password; an existing one only has to meet the length if one is typed. */
  protected readonly passwordInvalid = computed(() => {
    const password = this.password();
    if (this.isEditing() && password.length === 0) {
      return false;
    }
    return password.length < MIN_PASSWORD_LENGTH;
  });

  protected readonly passwordHint = computed(() =>
    this.i18n.t('console.users.passwordRequired', { count: MIN_PASSWORD_LENGTH }),
  );

  protected readonly deleteMessage = computed(() =>
    this.i18n.t('console.users.deleteConfirm', { name: this.user()?.username ?? '' }),
  );

  protected readonly canSubmit = computed(
    () => !this.busy() && !this.usernameInvalid() && !this.passwordInvalid(),
  );

  /** Which record the form was filled from, so switching rows reloads it and a re-render does not. */
  private loadedUserId: string | null = null;

  constructor() {
    effect(() => {
      const existing = this.user();
      const id = existing?.id ?? null;
      if (id === this.loadedUserId) {
        return;
      }
      this.loadedUserId = id;
      untracked(() => {
        this.username.set(existing?.username ?? '');
        this.role.set(existing?.role ?? 'user');
        this.disabled.set(existing?.disabled ?? false);
        // A password is never carried over from one record to the next.
        this.password.set('');
        this.confirmingDelete.set(false);
      });
    });
  }

  protected neverLabel(): string {
    return this.i18n.t('console.common.never');
  }

  protected moment(value: number): string {
    return formatMoment(value, this.i18n.locale());
  }

  protected submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const draft: UserDraft = {
      username: this.username().trim(),
      role: this.role(),
      disabled: this.disabled(),
    };
    if (this.password().length > 0) {
      draft.password = this.password();
    }
    this.submitted.emit(draft);
  }
}

/** Narrows a draft to the body `POST /api/admin/users` expects. */
export function toNewUser(draft: UserDraft): NewUser {
  return { username: draft.username, password: draft.password ?? '', role: draft.role };
}
