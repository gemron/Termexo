import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { LOGIN_ENDPOINT } from './console-api.service';
import { SessionService } from './session.service';

/**
 * Header the relay requires on every state-changing call.
 *
 * A cross-site form post cannot set it, so together with the SameSite cookie it is what keeps
 * another page from acting as the signed-in operator.
 */
const CSRF_HEADER = 'X-Requested-With';
const CSRF_HEADER_VALUE = 'termexo-console';
const UNAUTHORIZED = 401;
const LOGIN_ROUTE = '/login';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Sends the session cookie, marks mutating calls, and turns a dead session into a sign-in page. */
export const consoleInterceptor: HttpInterceptorFn = (request, next) => {
  const router = inject(Router);
  const session = inject(SessionService);

  const authorised = request.clone({
    withCredentials: true,
    setHeaders: SAFE_METHODS.has(request.method) ? {} : { [CSRF_HEADER]: CSRF_HEADER_VALUE },
  });

  return next(authorised).pipe(
    catchError((error: unknown) => {
      // A rejected sign-in belongs to the login form; redirecting would replace its message.
      const fromLogin = request.url.endsWith(LOGIN_ENDPOINT);
      if (error instanceof HttpErrorResponse && error.status === UNAUTHORIZED && !fromLogin) {
        session.clear();
        void router.navigate([LOGIN_ROUTE]);
      }
      return throwError(() => error);
    }),
  );
};
