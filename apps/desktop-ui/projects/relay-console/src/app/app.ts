import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { registerRelayConsoleTranslations } from './core/console.i18n';
import { ToastHostComponent } from './shared/toast-host';

// Registered at module scope so the wording is in place before any component asks for it.
registerRelayConsoleTranslations();

@Component({
  selector: 'console-root',
  imports: [RouterOutlet, ToastHostComponent],
  template: `
    <router-outlet />
    <console-toast-host />
  `,
})
export class App {}
