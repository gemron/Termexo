import { Component, inject } from '@angular/core';

import { IconComponent, TranslatePipe } from './workspace-ui';
import { ToastService } from '../core/toast.service';

/** Renders whatever the toast service is currently holding; one instance lives in the root. */
@Component({
  selector: 'console-toast-host',
  imports: [IconComponent, TranslatePipe],
  template: `
    @if (toasts.toasts().length > 0) {
      <div class="toast-host" role="status" aria-live="polite">
        @for (toast of toasts.toasts(); track toast.id) {
          <div class="toast" [attr.data-tone]="toast.tone">
            <span>{{ toast.message }}</span>
            <button
              type="button"
              class="btn btn-link"
              [attr.aria-label]="'console.common.close' | t"
              (click)="toasts.dismiss(toast.id)"
            >
              <app-icon name="x" [size]="14" />
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);
}
