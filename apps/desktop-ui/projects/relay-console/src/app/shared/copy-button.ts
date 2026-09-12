import { Component, inject, input, OnDestroy, signal } from '@angular/core';

import { I18nService, TranslatePipe } from './workspace-ui';
import { ToastService } from '../core/toast.service';

/** How long the button keeps confirming before it goes back to its own label. */
const COPY_FEEDBACK_MS = 1800;

/** Copies one value and says so, instead of leaving the operator guessing whether it worked. */
@Component({
  selector: 'console-copy-button',
  imports: [TranslatePipe],
  template: `
    <button type="button" [class]="buttonClass()" [disabled]="!value()" (click)="copy()">
      {{ (copied() ? 'console.common.copied' : label()) | t }}
    </button>
  `,
})
export class CopyButtonComponent implements OnDestroy {
  private readonly toasts = inject(ToastService);
  private readonly i18n = inject(I18nService);

  readonly value = input.required<string>();
  /** A translation key, so the button can say "Copy" or "Copy address" as the context needs. */
  readonly label = input('console.common.copy');
  readonly buttonClass = input('btn');

  protected readonly copied = signal(false);
  private timer = 0;

  ngOnDestroy(): void {
    window.clearTimeout(this.timer);
  }

  protected async copy(): Promise<void> {
    const value = this.value();
    if (!value) {
      return;
    }
    // A relay reached over plain HTTP is not a secure context, so there is no clipboard at all.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      this.toasts.error(this.i18n.t('console.common.copyFailed'));
      return;
    }
    try {
      await clipboard.writeText(value);
    } catch {
      this.toasts.error(this.i18n.t('console.common.copyFailed'));
      return;
    }
    this.copied.set(true);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.copied.set(false), COPY_FEEDBACK_MS);
  }
}
