import { Component, input, output } from '@angular/core';

import { TranslatePipe } from './workspace-ui';

/**
 * In-place confirmation for a destructive step.
 *
 * It replaces the row it belongs to rather than opening a dialog over the drawer that opened it:
 * a dialog on top of a drawer hides the very thing the operator is about to destroy.
 */
@Component({
  selector: 'console-confirm',
  imports: [TranslatePipe],
  template: `
    <div class="inline-confirm" role="alert">
      <p>{{ message() }}</p>
      <div class="form-actions">
        <button type="button" class="btn" [disabled]="busy()" (click)="cancelled.emit()">
          {{ 'console.common.cancel' | t }}
        </button>
        <!-- The confirming button names the act, never "OK". -->
        <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="confirmed.emit()">
          {{ confirmLabel() }}
        </button>
      </div>
    </div>
  `,
})
export class ConfirmBlockComponent {
  readonly message = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
