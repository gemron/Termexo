import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';
import { TerminalFontService } from './terminal-font.service';
import { filterTerminalFonts, SystemFont, terminalFontFamily } from './terminal-font';

/** Digits and letters terminals are judged on: a font that blurs 0/O or 1/l/I is hard to read. */
const PREVIEW_SAMPLE = '0O1lI';

const POPOVER_WIDTH = 272;
const POPOVER_MAX_HEIGHT = 360;
/** Keeps the popover clear of the window edges it would otherwise overflow. */
const VIEWPORT_MARGIN = 8;
/** Gap between the trigger and the popover, on whichever side it opens. */
const ANCHOR_GAP = 4;

/** A family plus the CSS stack used to render its own preview. */
interface FontOption extends SystemFont {
  readonly fontFamily: string;
}

/**
 * Terminal font picker.
 *
 * Replaces the native `<input list>` + `<datalist>` pairing, whose popup WebView2 renders in the
 * system light theme regardless of the page's `color-scheme` and which could only ever suggest a
 * hard-coded preset list. This popover is ordinary themed DOM listing every installed family,
 * monospaced ones first because they are the only families a terminal renders without drift.
 */
@Component({
  selector: 'app-terminal-font-picker',
  imports: [IconComponent, TranslatePipe],
  host: {
    '[class.open]': 'open()',
    '(document:pointerdown)': 'closeOnOutsidePointer($event)',
    '(document:keydown.escape)': 'close()',
    // A fixed popover cannot follow its trigger, so it is dismissed rather than left detached.
    '(window:resize)': 'close()',
  },
  template: `
    <button
      #trigger
      type="button"
      class="trigger"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="'terminal.font' | t"
      [title]="'terminal.fontHint' | t"
      (click)="toggle()"
    >
      <span class="label">{{ 'terminal.font' | t }}</span>
      <span class="current" [style.font-family]="currentFontFamily()">{{ value() }}</span>
      <app-icon name="chevron-down" [size]="10" />
    </button>

    @if (open()) {
      <div
        #popover
        class="popover"
        popover="manual"
        [style.left.px]="popoverLeft()"
        [style.top.px]="popoverTop()"
        [style.width.px]="popoverWidth"
        [style.maxHeight.px]="popoverMaxHeight"
        [attr.aria-label]="'terminal.font' | t"
        role="dialog"
      >
        <div class="search">
          <app-icon name="search" [size]="12" />
          <input
            #search
            type="text"
            role="combobox"
            autocomplete="off"
            spellcheck="false"
            aria-expanded="true"
            aria-controls="terminal-font-options"
            [value]="query()"
            [placeholder]="'terminal.fontSearch' | t"
            [attr.aria-label]="'terminal.fontSearch' | t"
            [attr.aria-activedescendant]="activeOptionId()"
            (input)="updateQuery($event)"
            (keydown)="navigate($event)"
          />
          @if (query()) {
            <button
              type="button"
              class="clear"
              [attr.aria-label]="'common.clearSearch' | t"
              (click)="clearQuery()"
            >
              <app-icon name="x" [size]="11" />
            </button>
          }
        </div>

        <ul
          #list
          id="terminal-font-options"
          class="options"
          role="listbox"
          [attr.aria-label]="'terminal.font' | t"
        >
          @for (font of matches(); track font.name; let index = $index) {
            @if (index === 0 && font.monospaced) {
              <li class="group" role="presentation">{{ 'terminal.fontMonospaced' | t }}</li>
            }
            @if (index === firstProportionalIndex()) {
              <li class="group" role="presentation">{{ 'terminal.fontProportional' | t }}</li>
            }
            <li role="option" [attr.aria-selected]="font.name === value()">
              <button
                type="button"
                [id]="optionId(index)"
                [attr.data-index]="index"
                [class.highlighted]="index === highlighted()"
                [class.selected]="font.name === value()"
                (mousemove)="highlighted.set(index)"
                (click)="select(font.name)"
              >
                <span class="name" [style.font-family]="font.fontFamily">{{ font.name }}</span>
                <span class="sample" [style.font-family]="font.fontFamily">{{ sample }}</span>
                <span class="mark">
                  @if (font.name === value()) {
                    <app-icon name="check" [size]="12" />
                  }
                </span>
              </button>
            </li>
          } @empty {
            <li class="empty">
              @if (fonts.loading()) {
                {{ 'common.loading' | t }}
              } @else {
                {{ 'terminal.fontNoMatch' | t }}
              }
            </li>
          }
        </ul>

        <p class="footer">{{ 'terminal.fontCount' | t: { count: matches().length } }}</p>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      min-width: 0;
    }

    .trigger {
      display: flex;
      height: 25px;
      max-width: 190px;
      min-width: 0;
      align-items: center;
      gap: 5px;
      margin-left: 4px;
      padding: 0 5px;
      border: 1px solid var(--border);
      border-radius: var(--radius-field);
      color: var(--text-muted);
      background: var(--surface-inset);
      cursor: pointer;
    }

    .trigger:hover,
    :host(.open) .trigger {
      border-color: var(--color-primary);
      color: var(--text);
    }

    .label {
      font: 9px/1 var(--sans);
      white-space: nowrap;
    }

    .current {
      overflow: hidden;
      flex: 1;
      min-width: 0;
      color: var(--text);
      font-size: 10px;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Width and max-height are bound from the component so the placement maths and the box agree.
       The inset and margin resets undo the UA popover styles, which would otherwise centre the
       box in the viewport and ignore the bound coordinates. */
    .popover {
      position: fixed;
      z-index: 60;
      display: flex;
      padding: 0;
      border: 1px solid var(--border-strong);
      margin: 0;
      flex-direction: column;
      inset: auto;
      /* Clips the search row and list to the rounded corners. */
      overflow: hidden;
      border-radius: 8px;
      background: var(--surface-1);
      box-shadow: 0 14px 35px rgb(0 0 0 / 40%);
    }

    .search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 8px;
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
    }

    .search input {
      width: 100%;
      min-width: 0;
      border: 0;
      color: var(--text);
      background: transparent;
      font: 11px/1.3 var(--sans);
      outline: none;
    }

    .search input::placeholder {
      color: var(--text-muted);
    }

    .clear {
      display: grid;
      padding: 2px;
      border-radius: 3px;
      color: var(--text-muted);
      cursor: pointer;
      place-items: center;
    }

    .clear:hover {
      color: var(--text);
      background: var(--surface-2);
    }

    .options {
      overflow-y: auto;
      flex: 1;
      padding: 4px;
      margin: 0;
      list-style: none;
    }

    /* Windows machines routinely carry 300+ families; skipping the layout and font work for rows
       that are scrolled out of view keeps opening the popover instant. */
    .options li[role='option'] {
      contain-intrinsic-size: auto 26px;
      content-visibility: auto;
    }

    .group {
      padding: 6px 7px 3px;
      color: var(--text-muted);
      font: 9px/1 var(--sans);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .options li[role='option'] button {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 8px;
      padding: 4px 7px;
      border-radius: 4px;
      color: var(--text);
      cursor: pointer;
      text-align: left;
    }

    .options li[role='option'] button.highlighted {
      background: var(--surface-2);
    }

    .options li[role='option'] button.selected {
      color: var(--text-primary);
    }

    .name {
      overflow: hidden;
      flex: 1;
      min-width: 0;
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sample {
      color: var(--text-muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .mark {
      display: grid;
      width: 12px;
      color: var(--color-primary);
      place-items: center;
    }

    .empty {
      padding: 14px 8px;
      color: var(--text-muted);
      font-size: 11px;
      text-align: center;
    }

    .footer {
      padding: 5px 8px;
      border-top: 1px solid var(--border);
      margin: 0;
      color: var(--text-muted);
      font: 9px/1.2 var(--sans);
    }

    /* The toolbar sheds labels before widths as it narrows, matching its other controls. */
    @media (max-width: 1120px) {
      .label {
        display: none;
      }
    }

    @media (max-width: 860px) {
      .trigger {
        max-width: 120px;
      }
    }
  `,
})
export class TerminalFontPickerComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly triggerButton = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly optionList = viewChild<ElementRef<HTMLUListElement>>('list');
  private readonly popover = viewChild<ElementRef<HTMLElement>>('popover');
  /** The popover element already promoted to the top layer, so each one is shown exactly once. */
  private shownPopover: HTMLElement | null = null;

  protected readonly fonts = inject(TerminalFontService);
  protected readonly sample = PREVIEW_SAMPLE;
  protected readonly popoverWidth = POPOVER_WIDTH;
  protected readonly popoverMaxHeight = POPOVER_MAX_HEIGHT;
  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly highlighted = signal(0);
  protected readonly popoverLeft = signal(0);
  protected readonly popoverTop = signal(0);

  /** The family currently applied to the terminal. */
  readonly value = input.required<string>();
  readonly fontChange = output<string>();

  protected readonly currentFontFamily = computed(() => terminalFontFamily(this.value()));

  /**
   * Matching families, monospaced first.
   *
   * `sort` is stable, so each group keeps the alphabetical order the enumerator returned.
   */
  protected readonly matches = computed<readonly FontOption[]>(() =>
    [...filterTerminalFonts(this.fonts.fonts(), this.query())]
      .sort((left, right) => Number(right.monospaced) - Number(left.monospaced))
      .map((font) => ({ ...font, fontFamily: terminalFontFamily(font.name) })),
  );

  /** Where the proportional group starts, or -1 when every match is monospaced. */
  protected readonly firstProportionalIndex = computed(() =>
    this.matches().findIndex((font) => !font.monospaced),
  );

  protected readonly activeOptionId = computed(() =>
    this.open() && this.matches().length > 0 ? this.optionId(this.highlighted()) : null,
  );

  constructor() {
    // The toolbar sits inside a backdrop-filtered ancestor, which becomes the containing block
    // for fixed positioning and would offset the popover by that ancestor's position. Promoting
    // it to the top layer restores viewport coordinates and takes it out of the z-index stack.
    //
    // Each open renders a fresh element, so showing it once as it appears is enough. Where the
    // Popover API is missing the attribute is inert too, leaving an ordinary positioned panel.
    effect(() => {
      const element = this.popover()?.nativeElement ?? null;
      if (element !== this.shownPopover) {
        this.shownPopover = element;
        element?.showPopover?.();
      }
    });

    // Keeping the highlighted row on screen is what makes arrow-key browsing usable in a list
    // this long; it also reveals the current font when the popover first opens.
    effect(() => {
      const index = this.highlighted();
      if (!this.open()) {
        return;
      }
      const list = this.optionList()?.nativeElement;
      requestAnimationFrame(() => {
        list?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
      });
    });
  }

  protected optionId(index: number): string {
    return `terminal-font-option-${index}`;
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }

    this.query.set('');
    this.positionPopover();
    this.open.set(true);
    // The search box renders on the next frame, so focus waits for it.
    requestAnimationFrame(() => this.searchInput()?.nativeElement.focus());

    // On the desktop the families arrive over IPC, so the starting highlight has to wait for
    // them or it would settle on the first row of an empty list. Anything the user has already
    // typed or highlighted in the meantime wins.
    void this.fonts.load().then(() => {
      if (this.open() && !this.query()) {
        requestAnimationFrame(() => this.highlightCurrentFont());
      }
    });
  }

  protected close(): void {
    if (this.open()) {
      this.open.set(false);
    }
  }

  protected closeOnOutsidePointer(event: PointerEvent): void {
    const target = event.target;
    if (target instanceof Node && !this.host.nativeElement.contains(target)) {
      this.close();
    }
  }

  protected updateQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    // The previous highlight refers to a row the new filter may not contain.
    this.highlighted.set(0);
  }

  protected clearQuery(): void {
    this.query.set('');
    this.highlighted.set(0);
    this.searchInput()?.nativeElement.focus();
  }

  protected navigate(event: KeyboardEvent): void {
    const count = this.matches().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.moveHighlight(1, count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveHighlight(-1, count);
        break;
      case 'Home':
        event.preventDefault();
        this.highlighted.set(0);
        break;
      case 'End':
        event.preventDefault();
        this.highlighted.set(Math.max(count - 1, 0));
        break;
      case 'Enter': {
        event.preventDefault();
        const font = this.matches()[this.highlighted()];
        if (font) {
          this.select(font.name);
        }
        break;
      }
      default:
        break;
    }
  }

  protected select(name: string): void {
    this.fontChange.emit(name);
    this.close();
    this.triggerButton().nativeElement.focus();
  }

  /** Wraps at both ends so holding an arrow key never dead-ends. */
  private moveHighlight(delta: number, count: number): void {
    if (count === 0) {
      return;
    }
    this.highlighted.set((this.highlighted() + delta + count) % count);
  }

  private highlightCurrentFont(): void {
    const index = this.matches().findIndex((font) => font.name === this.value());
    this.highlighted.set(Math.max(index, 0));
  }

  /**
   * Anchors the popover to the trigger in viewport coordinates.
   *
   * The top layer takes the panel out of normal flow, so it is placed by hand: aligned to the
   * trigger, pulled back from the edges it would overflow, and flipped above when the window is
   * too short to show the list below.
   */
  private positionPopover(): void {
    const anchor = this.triggerButton().nativeElement.getBoundingClientRect();
    const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
    this.popoverLeft.set(Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxLeft)));

    // Below the trigger normally, above it when the window is too short for the full list.
    const below = anchor.bottom + ANCHOR_GAP;
    const overflowsBottom = below + POPOVER_MAX_HEIGHT > window.innerHeight - VIEWPORT_MARGIN;
    const above = anchor.top - POPOVER_MAX_HEIGHT - ANCHOR_GAP;
    this.popoverTop.set(overflowsBottom && above > VIEWPORT_MARGIN ? above : below);
  }
}
