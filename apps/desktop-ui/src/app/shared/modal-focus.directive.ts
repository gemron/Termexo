import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Directive,
  ElementRef,
  inject,
  Injectable,
  OnDestroy,
  output,
} from '@angular/core';

const FOCUSABLE =
  'button, input:not([type="hidden"]), select, textarea, a[href], [tabindex], [contenteditable="true"]';

/** Registration order also covers nested directory prompts opened from an existing dialog. */
@Injectable({ providedIn: 'root' })
class ModalStack {
  readonly elements: HTMLElement[] = [];
  get current(): HTMLElement | undefined {
    return this.elements.at(-1);
  }
}

/** Keyboard containment shared by modal dialogs; dismissal keeps each owner's busy/dirty guards. */
@Directive({ selector: '[appModal]' })
export class ModalFocusDirective implements OnDestroy {
  readonly dismissModal = output<void>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly stack = inject(ModalStack);
  private readonly previousFocus = this.document.activeElement as HTMLElement | null;
  private destroyed = false;

  constructor() {
    this.element.tabIndex = -1;
    this.stack.elements.push(this.element);
    this.document.addEventListener('keydown', this.onKeydown);
    this.document.addEventListener('focusin', this.onFocusIn);
    afterNextRender(() => {
      if (!this.destroyed && this.stack.current === this.element) this.focusInitial();
    });
  }

  private controls(): HTMLElement[] {
    return [...this.element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (control) =>
        control.tabIndex >= 0 &&
        !control.matches(':disabled') &&
        !control.closest('[inert]') &&
        control.getClientRects().length > 0 &&
        getComputedStyle(control).visibility !== 'hidden',
    );
  }

  private focusInitial(): void {
    const controls = this.controls();
    const initial =
      controls.find((control) => control.hasAttribute('autofocus')) ??
      controls.find((control) =>
        control.matches('input:not([type="checkbox"]), textarea, select'),
      ) ??
      controls[0] ??
      this.element;
    initial.focus({ preventScroll: true });
  }

  private readonly onFocusIn = (event: FocusEvent): void => {
    if (this.stack.current !== this.element || this.element.contains(event.target as Node)) return;
    this.focusInitial();
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (this.stack.current !== this.element || event.defaultPrevented || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dismissModal.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = this.controls();
    const index = controls.indexOf(this.document.activeElement as HTMLElement);
    if (
      !controls.length ||
      index < 0 ||
      (event.shiftKey ? index === 0 : index === controls.length - 1)
    ) {
      event.preventDefault();
      const next = event.shiftKey ? controls.at(-1) : controls[0];
      (next ?? this.element).focus({ preventScroll: true });
    }
  };

  ngOnDestroy(): void {
    this.destroyed = true;
    const wasCurrent = this.stack.current === this.element;
    const index = this.stack.elements.indexOf(this.element);
    if (index >= 0) this.stack.elements.splice(index, 1);
    this.document.removeEventListener('keydown', this.onKeydown);
    this.document.removeEventListener('focusin', this.onFocusIn);
    // A replacement dialog claims focus itself. Restore only to a surviving trigger.
    queueMicrotask(() => {
      if (!wasCurrent || !this.previousFocus?.isConnected) return;
      if (this.stack.current && !this.stack.current.contains(this.previousFocus)) return;
      this.previousFocus.focus({ preventScroll: true });
    });
  }
}
