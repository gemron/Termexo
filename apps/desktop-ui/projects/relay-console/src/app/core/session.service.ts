import { computed, inject, Injectable, signal } from '@angular/core';

import { ConsoleApiService } from './console-api.service';
import type { UserView } from './console.models';

/**
 * Who is signed in, as far as this page knows.
 *
 * The real session is an HttpOnly cookie the page cannot read, so the only way to learn about it
 * is to ask `/api/me`. Nothing here runs in the constructor: the HTTP interceptor injects this
 * service, and a request made while it was still being constructed would be a dependency cycle.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ConsoleApiService);
  private readonly userValue = signal<UserView | null>(null);
  private readonly resolvedValue = signal(false);
  /** Shared by every guard on the first navigation, so they make one request between them. */
  private pending: Promise<UserView | null> | null = null;

  readonly user = this.userValue.asReadonly();
  readonly isAdmin = computed(() => this.userValue()?.role === 'admin');

  /** Resolves the cookie session once, then answers from memory. */
  restore(): Promise<UserView | null> {
    if (this.resolvedValue()) {
      return Promise.resolve(this.userValue());
    }
    this.pending ??= this.api.me().then(
      (user) => this.adopt(user),
      // A 401 here is the normal "not signed in yet" answer, not a failure worth reporting.
      () => this.adopt(null),
    );
    return this.pending;
  }

  async signIn(username: string, password: string): Promise<UserView> {
    const user = await this.api.signIn(username, password);
    this.adopt(user);
    return user;
  }

  async signOut(): Promise<void> {
    try {
      await this.api.signOut();
    } finally {
      // Whatever the relay answered, this browser is done with the session it was holding.
      this.clear();
    }
  }

  /** Drops the local view of the session; the interceptor calls this when the relay says 401. */
  clear(): void {
    this.adopt(null);
  }

  private adopt(user: UserView | null): UserView | null {
    this.userValue.set(user);
    this.resolvedValue.set(true);
    this.pending = Promise.resolve(user);
    return user;
  }
}
