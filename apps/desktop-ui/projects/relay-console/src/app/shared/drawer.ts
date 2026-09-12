import { Component, input, output } from '@angular/core';

import { IconComponent, TranslatePipe } from './workspace-ui';

/**
 * Side panel for detail and editing.
 *
 * A drawer keeps the list it was opened from on screen, so the operator never loses track of
 * which row they are working on — which a modal dialog over a table does not manage.
 */
@Component({
  selector: 'console-drawer',
  imports: [IconComponent, TranslatePipe],
  host: {
    // Escape is what every browser user reaches for first to leave a panel like this.
    '(document:keydown.escape)': 'closed.emit()',
  },
  template: `
    <button
      type="button"
      class="drawer-backdrop"
      [attr.aria-label]="'console.common.close' | t"
      (click)="closed.emit()"
    ></button>
    <aside class="drawer-panel" role="dialog" aria-modal="true" [attr.aria-label]="heading()">
      <header class="drawer-head">
        <h2>{{ heading() }}</h2>
        <button
          type="button"
          class="btn btn-link"
          [attr.aria-label]="'console.common.close' | t"
          [title]="'console.common.close' | t"
          (click)="closed.emit()"
        >
          <app-icon name="x" [size]="16" />
        </button>
      </header>
      <div class="drawer-content">
        <ng-content />
      </div>
    </aside>
  `,
})
export class DrawerComponent {
  readonly heading = input.required<string>();
  readonly closed = output<void>();
}
