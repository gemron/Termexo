import { Routes } from '@angular/router';

import { adminGuard, signedInGuard, signedOutGuard } from './core/console.guards';

/**
 * Every page loads lazily.
 *
 * A plain user never opens the administration pages, and an administrator opens most of them
 * once in a while, so nothing but the shell belongs in the first download.
 */
export const CONSOLE_ROUTES: Routes = [
  {
    path: 'login',
    canActivate: [signedOutGuard],
    loadComponent: () => import('./pages/login-page').then((m) => m.LoginPageComponent),
  },
  {
    path: '',
    canActivate: [signedInGuard],
    loadComponent: () => import('./console-shell').then((m) => m.ConsoleShellComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/overview-page').then((m) => m.OverviewPageComponent),
      },
      {
        path: 'devices',
        loadComponent: () => import('./pages/devices-page').then((m) => m.DevicesPageComponent),
      },
      {
        path: 'password',
        loadComponent: () => import('./pages/password-page').then((m) => m.PasswordPageComponent),
      },
      {
        path: 'users',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/users-page').then((m) => m.UsersPageComponent),
      },
      {
        path: 'enrollments',
        canActivate: [adminGuard],
        loadComponent: () =>
          import('./pages/enrollments-page').then((m) => m.EnrollmentsPageComponent),
      },
      {
        path: 'relays',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/relays-page').then((m) => m.RelaysPageComponent),
      },
      {
        path: 'audit',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/audit-page').then((m) => m.AuditPageComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
