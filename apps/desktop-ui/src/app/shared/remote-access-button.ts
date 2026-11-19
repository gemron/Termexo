import { Component, output } from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from './icon/icon';

@Component({
  selector: 'app-remote-access-button',
  imports: [IconComponent, TranslatePipe],
  template: `
    <button type="button" data-testid="remote-access-open" (click)="opened.emit()">
      <app-icon name="devices" [size]="15" />
      {{ 'settings.tabRemote' | t }}
    </button>
  `,
  styles: `
    button {
      display: inline-flex;
      width: 100%;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 0 8px;
      border: 0;
      border-radius: 3px;
      color: var(--text-secondary);
      background: transparent;
      font-size: 12px;
      white-space: nowrap;
    }
    button:hover,
    button:focus-visible {
      color: var(--text);
      background: var(--surface-2);
    }
  `,
})
export class RemoteAccessButtonComponent {
  readonly opened = output<void>();
}
