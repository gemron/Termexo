import { Component, computed, inject, signal } from '@angular/core';

import { ConsoleApiService } from '../core/console-api.service';
import { describeConsoleError } from '../core/console-error';
import { registerRelayConsoleTranslations } from '../core/console.i18n';
import type { UserPatch, UserView } from '../core/console.models';
import { ToastService } from '../core/toast.service';
import { formatMoment } from '../shared/format';
import { PageState, StateBlockComponent } from '../shared/state-block';
import { I18nService, TranslatePipe } from '../shared/workspace-ui';
import { toNewUser, UserDraft, UserDrawerComponent } from './user-drawer';

// Registered at module scope so the wording is in place before the component is built.
registerRelayConsoleTranslations();

/** Marks the drawer as creating a user rather than editing one. */
const CREATING = 'creating';

@Component({
  selector: 'console-users-page',
  imports: [StateBlockComponent, TranslatePipe, UserDrawerComponent],
  template: `
    <header class="page-header">
      <div>
        <h1>{{ 'console.users.title' | t }}</h1>
        <p>{{ 'console.users.subtitle' | t }}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="btn" [disabled]="loading()" (click)="reload()">
          {{ 'console.common.refresh' | t }}
        </button>
        <button type="button" class="btn btn-primary" (click)="openCreate()">
          {{ 'console.users.create' | t }}
        </button>
      </div>
    </header>

    @if (state() === 'ready') {
      <div class="card">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ 'console.users.username' | t }}</th>
                <th>{{ 'console.users.role' | t }}</th>
                <th>{{ 'console.users.status' | t }}</th>
                <th>{{ 'console.users.devices' | t }}</th>
                <th>{{ 'console.users.lastLogin' | t }}</th>
                <th>{{ 'console.users.createdAt' | t }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (user of users(); track user.id) {
                <tr>
                  <td class="cell-name">{{ user.username }}</td>
                  <td>{{ roleLabel(user) }}</td>
                  <td>
                    <span class="status" [attr.data-tone]="user.disabled ? 'danger' : 'online'">
                      {{ (user.disabled ? 'console.users.disabled' : 'console.users.enabled') | t }}
                    </span>
                  </td>
                  <td>{{ user.deviceCount }}</td>
                  <td>
                    {{ user.lastLoginAt ? moment(user.lastLoginAt) : ('console.common.never' | t) }}
                  </td>
                  <td>{{ moment(user.createdAt) }}</td>
                  <td>
                    <div class="cell-actions">
                      <button type="button" class="btn btn-link" (click)="openEdit(user)">
                        {{ 'console.common.details' | t }}
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    } @else {
      <console-state-block
        [state]="state()"
        [error]="error()"
        [emptyTitle]="'console.users.empty' | t"
        [emptyHelp]="'console.users.emptyHelp' | t"
        [actionLabel]="'console.users.create' | t"
        (retry)="reload()"
        (action)="openCreate()"
      />
    }

    @if (drawerOpen()) {
      <console-user-drawer
        [user]="editing()"
        [busy]="acting()"
        [error]="actionError()"
        (closed)="closeDrawer()"
        (submitted)="submit($event)"
        (deleted)="remove()"
      />
    }
  `,
})
export class UsersPageComponent {
  private readonly api = inject(ConsoleApiService);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly users = signal<UserView[]>([]);
  protected readonly loading = signal(true);
  protected readonly acting = signal(false);
  protected readonly error = signal('');
  protected readonly actionError = signal('');
  /** Either `CREATING`, a user id, or null when the drawer is closed. */
  protected readonly selection = signal<string | null>(null);

  protected readonly state = computed<PageState>(() => {
    if (this.loading()) return 'loading';
    if (this.error()) return 'error';
    return this.users().length === 0 ? 'empty' : 'ready';
  });

  protected readonly drawerOpen = computed(() => this.selection() !== null);

  protected readonly editing = computed(() => {
    const selection = this.selection();
    if (!selection || selection === CREATING) {
      return null;
    }
    return this.users().find((user) => user.id === selection) ?? null;
  });

  constructor() {
    void this.load();
  }

  protected reload(): void {
    void this.load();
  }

  protected moment(value: number): string {
    return formatMoment(value, this.i18n.locale());
  }

  protected roleLabel(user: UserView): string {
    return this.i18n.t(user.role === 'admin' ? 'console.role.admin' : 'console.role.user');
  }

  protected openCreate(): void {
    this.actionError.set('');
    this.selection.set(CREATING);
  }

  protected openEdit(user: UserView): void {
    this.actionError.set('');
    this.selection.set(user.id);
  }

  protected closeDrawer(): void {
    this.selection.set(null);
    this.actionError.set('');
  }

  protected async submit(draft: UserDraft): Promise<void> {
    const existing = this.editing();
    if (existing) {
      await this.act(
        () => this.api.updateUser(existing.id, this.buildPatch(existing, draft)),
        () => this.i18n.t('console.users.updated', { name: draft.username }),
      );
      return;
    }
    await this.act(
      () => this.api.createUser(toNewUser(draft)),
      () => this.i18n.t('console.users.created', { name: draft.username }),
    );
  }

  protected async remove(): Promise<void> {
    const existing = this.editing();
    if (!existing) {
      return;
    }
    await this.act(
      () => this.api.deleteUser(existing.id),
      () => this.i18n.t('console.users.deleted', { name: existing.username }),
    );
  }

  /** Sends only what actually changed, so a role stays put when the password is the point. */
  private buildPatch(existing: UserView, draft: UserDraft): UserPatch {
    const patch: UserPatch = {};
    if (draft.role !== existing.role) patch.role = draft.role;
    if (draft.disabled !== existing.disabled) patch.disabled = draft.disabled;
    if (draft.password) patch.password = draft.password;
    return patch;
  }

  private async act(run: () => Promise<unknown>, success: () => string): Promise<void> {
    if (this.acting()) {
      return;
    }
    this.acting.set(true);
    this.actionError.set('');
    try {
      await run();
      this.toasts.success(success());
      this.selection.set(null);
      await this.load();
    } catch (error) {
      this.actionError.set(
        this.i18n.t('console.common.actionFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.acting.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.users.set(await this.api.listUsers());
    } catch (error) {
      this.error.set(
        this.i18n.t('console.common.loadFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.loading.set(false);
    }
  }
}
