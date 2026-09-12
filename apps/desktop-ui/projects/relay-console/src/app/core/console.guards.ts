import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SessionService } from './session.service';

const LOGIN_ROUTE = '/login';
const HOME_ROUTE = '/';

/** Keeps every page behind a resolved session, so no view flashes before the redirect. */
export const signedInGuard: CanActivateFn = async () => {
  // `inject` must run before the first await; afterwards there is no injection context left.
  const session = inject(SessionService);
  const router = inject(Router);
  const user = await session.restore();
  return user ? true : router.createUrlTree([LOGIN_ROUTE]);
};

/**
 * Guards the administration pages.
 *
 * The relay enforces the same rule; this only keeps a plain user from reaching a page that would
 * answer 403 to every request it makes.
 */
export const adminGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);
  const user = await session.restore();
  if (!user) {
    return router.createUrlTree([LOGIN_ROUTE]);
  }
  return user.role === 'admin' ? true : router.createUrlTree([HOME_ROUTE]);
};

/** Sends an operator who is already signed in straight to the console instead of the form. */
export const signedOutGuard: CanActivateFn = async () => {
  const session = inject(SessionService);
  const router = inject(Router);
  const user = await session.restore();
  return user ? router.createUrlTree([HOME_ROUTE]) : true;
};
