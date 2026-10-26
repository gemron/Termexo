import {
  Component,
  ElementRef,
  HostListener,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { ModalFocusDirective } from '../shared/modal-focus.directive';
import type { CloseConfirmAnchor } from './terminal-close-request';

@Component({
  selector: 'app-terminal-close-confirm',
  imports: [TranslatePipe, ModalFocusDirective],
  template: `
    <div
      #panel
      appModal
      popover="manual"
      class="terminal-close-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-describedby="terminal-close-message"
      [attr.aria-label]="'terminal.close' | t"
      [style.left.px]="position().x"
      [style.top.px]="position().y"
      (dismissModal)="cancelled.emit()"
    >
      <p id="terminal-close-message">{{ 'terminal.closeRunningConfirm' | t }}</p>
      <div class="terminal-close-actions">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          [disabled]="busy()"
          (click)="cancelled.emit()"
        >
          {{ 'common.cancel' | t }}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-error"
          [disabled]="busy()"
          (click)="confirmed.emit()"
        >
          {{ 'terminal.closeForce' | t }}
        </button>
      </div>
    </div>
  `,
  styleUrl: './terminal-close-confirm.scss',
})
export class TerminalCloseConfirmComponent {
  readonly anchor = input.required<CloseConfirmAnchor>();
  readonly busy = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private shownPanel?: HTMLElement;
  protected readonly position = signal<CloseConfirmAnchor>({ x: 0, y: 0 });

  constructor() {
    effect(() => {
      this.anchor();
      const element = this.panel()?.nativeElement;
      if (element) {
        // The top layer keeps viewport coordinates correct inside filtered ancestors.
        if (element !== this.shownPanel) {
          this.shownPanel = element;
          element.showPopover?.();
        }
        this.reposition();
      }
    });
  }

  @HostListener('window:resize')
  protected reposition(): void {
    const element = this.panel()?.nativeElement;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const { x, y } = this.anchor();
    const margin = 8;
    const gap = 10;
    const left = x + gap + width <= window.innerWidth - margin ? x + gap : x - width - gap;
    const top = y + gap + height <= window.innerHeight - margin ? y + gap : y - height - gap;
    this.position.set({
      x: Math.max(margin, Math.min(left, window.innerWidth - width - margin)),
      y: Math.max(margin, Math.min(top, window.innerHeight - height - margin)),
    });
  }

  @HostListener('document:pointerdown', ['$event'])
  protected cancelOnOutsidePointer(event: PointerEvent): void {
    if (event.target instanceof Node && !this.panel()?.nativeElement.contains(event.target)) {
      this.cancelled.emit();
    }
  }
}
