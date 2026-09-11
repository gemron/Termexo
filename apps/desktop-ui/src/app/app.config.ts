import {
  ApplicationConfig,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { suppressNativeBrowserBehaviour } from './core/services/native-browser-behaviour';
import { runtimeMode } from './core/services/tauri-runtime';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(() => {
      // Only the desktop window. A remote client is a real browser, where the same menu carries
      // the long-press text selection a phone has no other way to reach and reload is how a page
      // recovers, and the preview is a browser a developer is deliberately looking at.
      if (runtimeMode() === 'desktop') {
        suppressNativeBrowserBehaviour();
      }
    }),
    provideRouter(routes),
  ],
};
