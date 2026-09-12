import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ConsoleApiService } from './core/console-api.service';
import { describeConsoleError } from './core/console-error';
import { registerRelayConsoleTranslations } from './core/console.i18n';
import { SessionService } from './core/session.service';
import { ToastService } from './core/toast.service';
import { I18nService, IconComponent, TranslatePipe } from './shared/workspace-ui';

// Registered at module scope so the wording is in place before the component is built.
registerRelayConsoleTranslations();

/** One entry in the left navigation; `adminOnly` mirrors the guard on the matching route. */
interface NavItem {
  path: string;
  labelKey: string;
  icon: string;
  adminOnly: boolean;
  exact: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', labelKey: 'console.nav.overview', icon: 'gauge', adminOnly: false, exact: true },
  {
    path: '/devices',
    labelKey: 'console.nav.devices',
    icon: 'devices',
    adminOnly: false,
    exact: false,
  },
  { path: '/users', labelKey: 'console.nav.users', icon: 'users', adminOnly: true, exact: false },
  {
    path: '/enrollments',
    labelKey: 'console.nav.enrollments',
    icon: 'key',
    adminOnly: true,
    exact: false,
  },
  {
    path: '/relays',
    labelKey: 'console.nav.relays',
    icon: 'server',
    adminOnly: true,
    exact: false,
  },
  { path: '/audit', labelKey: 'console.nav.audit', icon: 'history', adminOnly: true, exact: false },
  {
    path: '/password',
    labelKey: 'console.nav.password',
    icon: 'shield',
    adminOnly: false,
    exact: false,
  },
];

/**
 * Frame every signed-in page renders inside.
 *
 * It owns the two things that are true on every page — who is signed in and which relay this is —
 * so no page has to fetch them again.
 */
@Component({
  selector: 'console-shell',
  imports: [IconComponent, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe],
  template: `
    <div class="console-shell">
      <header class="console-topbar">
        <div class="console-brand">
          <app-icon name="server" [size]="18" />
          <span>{{ 'console.title' | t }}</span>
          @if (relayId(); as id) {
            <small>{{ id }}</small>
          }
        </div>
        <div class="console-session">
          @if (session.user(); as user) {
            <span>{{ user.username }}</span>
            <span class="tag">{{ roleLabel() }}</span>
          }
          <button type="button" class="btn" [disabled]="signingOut()" (click)="signOut()">
            {{ 'console.signOut' | t }}
          </button>
        </div>
      </header>

      <div class="console-body">
        <nav class="console-nav" [attr.aria-label]="'console.title' | t">
          @for (item of visibleNav(); track item.path) {
            <a
              class="console-nav-link"
              routerLinkActive="active"
              [routerLink]="item.path"
              [routerLinkActiveOptions]="{ exact: item.exact }"
            >
              <app-icon [name]="item.icon" [size]="15" />
              <span>{{ item.labelKey | t }}</span>
            </a>
          }
        </nav>

        <main class="console-main">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class ConsoleShellComponent {
  protected readonly session = inject(SessionService);
  private readonly api = inject(ConsoleApiService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18nService);

  protected readonly relayId = signal('');
  protected readonly signingOut = signal(false);

  protected readonly visibleNav = computed(() => {
    const isAdmin = this.session.isAdmin();
    return NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);
  });

  protected readonly roleLabel = computed(() =>
    this.i18n.t(this.session.isAdmin() ? 'console.role.admin' : 'console.role.user'),
  );

  constructor() {
    // Unauthenticated and cheap; it only names the relay in the title bar, so a failure is silent.
    void this.api
      .health()
      .then((health) => this.relayId.set(health.relayId))
      .catch(() => this.relayId.set(''));
  }

  protected async signOut(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.session.signOut();
      await this.router.navigate(['/login']);
    } catch (error) {
      this.toasts.error(
        this.i18n.t('console.common.actionFailed', { error: describeConsoleError(error) }),
      );
    } finally {
      this.signingOut.set(false);
    }
  }
}
