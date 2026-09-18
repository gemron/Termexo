import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input, output } from '@angular/core';

/** Keeps a menu outside scroll clipping and inside the viewport. */
@Directive({
  selector: '[appAnchoredMenu]',
  host: {
    'popover': 'manual',
    '(document:pointerdown)': 'onOutsidePointer($event)',
    '(document:keydown.escape)': 'onEscape($event)',
    '(keydown)': 'onKeydown($event)',
    '(window:resize)': 'dismissed.emit()',
  },
})
export class AnchoredMenuDirective implements AfterViewInit, OnDestroy {
  readonly appAnchoredMenu = input.required<HTMLElement>();
  readonly dismissed = output<void>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = this.element.ownerDocument;
  /**
   * Watches the anchor: when it scrolls out of the viewport the menu loses its reference
   * point, so dismissing keeps a floating popover from drifting into the wrong region.
   * Older WebView2 builds without IntersectionObserver fall back to the scroll listener.
   */
  private anchorObserver: IntersectionObserver | null = null;

  ngAfterViewInit(): void {
    // The template also lives outside the board's scroll containers for older WebView2 builds.
    this.element.showPopover?.();
    this.position();
    this.items()[0]?.focus({ preventScroll: true });
    this.document.addEventListener('scroll', this.onScroll, true);
    this.observeAnchor();
  }

  ngOnDestroy(): void {
    this.document.removeEventListener('scroll', this.onScroll, true);
    this.anchorObserver?.disconnect();
  }

  private observeAnchor(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.anchorObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && !entry.isIntersecting) this.dismissed.emit();
      },
      { root: this.document },
    );
    this.anchorObserver.observe(this.appAnchoredMenu());
  }

  private position(): void {
    const margin = 8;
    const gap = 4;
    const viewport = this.document.documentElement;
    const width = viewport.clientWidth || window.innerWidth;
    const height = viewport.clientHeight || window.innerHeight;
    const anchor = this.appAnchoredMenu().getBoundingClientRect();
    // Without a visible anchor the previous layout has no meaning — drop the menu so it
    // can't keep showing over a region unrelated to the trigger. A zero-sized rect means the
    // anchor hasn't been laid out yet (jsdom, freshly inserted) so we leave the dismissal to
    // the IntersectionObserver instead of dropping the menu on first paint.
    if (anchor.width > 0 && anchor.height > 0) {
      if (anchor.bottom <= 0 || anchor.top >= height || anchor.right <= 0 || anchor.left >= width) {
        this.dismissed.emit();
        return;
      }
    }
    const below = Math.max(0, height - anchor.bottom - gap - margin);
    const above = Math.max(0, anchor.top - gap - margin);
    this.element.style.maxWidth = `${Math.max(0, width - margin * 2)}px`;
    this.element.style.maxHeight = `${Math.max(above, below)}px`;
    const menu = this.element.getBoundingClientRect();
    const opensBelow = below >= menu.height || below >= above;
    const left = Math.max(margin, Math.min(anchor.right - menu.width, width - menu.width - margin));
    const top = opensBelow ? anchor.bottom + gap : anchor.top - gap - menu.height;
    this.element.style.left = `${left}px`;
    this.element.style.top = `${Math.max(margin, Math.min(top, height - menu.height - margin))}px`;
  }

  protected onOutsidePointer(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (target && !this.element.contains(target) && !this.appAnchoredMenu().contains(target)) {
      this.dismissed.emit();
    }
  }

  protected onEscape(event: Event): void {
    event.stopPropagation();
    this.appAnchoredMenu().focus();
    this.dismissed.emit();
  }

  private items(): HTMLButtonElement[] {
    return Array.from(this.element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      this.appAnchoredMenu().focus({ preventScroll: true });
      this.dismissed.emit();
      return;
    }
    const items = this.items();
    if (!items.length) return;
    const index = items.indexOf(this.document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (index + 1) % items.length; break;
      case 'ArrowUp': next = (index - 1 + items.length) % items.length; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    items[next].focus({ preventScroll: true });
  }

  private readonly onScroll = (event: Event): void => {
    // Scrolling a long menu is allowed; scrolling its anchor's container closes the menu.
    if (!this.element.contains(event.target as Node | null)) this.dismissed.emit();
  };
}
