import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { CONSOLE_ROUTES } from './app.routes';
import { consoleInterceptor } from './core/console.interceptor';

export const consoleAppConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(CONSOLE_ROUTES, withComponentInputBinding()),
    provideHttpClient(withInterceptors([consoleInterceptor])),
  ],
};
