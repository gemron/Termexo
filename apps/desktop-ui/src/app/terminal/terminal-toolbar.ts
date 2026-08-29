import {
  Component,
  HostListener,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { TranslatePipe } from '../core/i18n/translate.pipe';
import {
  LayoutMode,
  MAX_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_GRID_DIMENSION,
  MIN_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_GRID_DIMENSION,
} from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';
import { DEFAULT_TERMINAL_FONT_NAME } from './terminal-font';
import { TerminalFontPickerComponent } from './terminal-font-picker';

/** Settings kept behind a trigger so the tab strip beside them keeps the width instead. */
type ToolbarPopover = 'appearance' | 'grid';

/**
 * The controls sitting to the right of the terminal tab strip.
 *
 * Layout and the counter stay visible because they describe what the tabs are doing; font and
 * grid settings are changed rarely and live in popovers, which is what leaves the strip enough
 * room to show more than a couple of tabs.
 */
@Component({
  selector: 'app-terminal-toolbar',
  imports: [IconComponent, TerminalFontPickerComponent, TranslatePipe],
  templateUrl: './terminal-toolbar.html',
  styleUrl: './terminal-toolbar.scss',
})
export class TerminalToolbarComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly visibleCount = input.required<number>();
  readonly visibleLimit = input.required<number>();
  readonly terminalCount = input.required<number>();
  readonly layout = input.required<LayoutMode>();
  readonly gridColumns = input.required<number>();
  readonly gridRows = input.required<number>();
  readonly fontSize = input.required<number>();
  readonly fontName = input(DEFAULT_TERMINAL_FONT_NAME);

  readonly promptLibraryRequested = output<void>();
  readonly handoffRequested = output<void>();
  readonly layoutChange = output<LayoutMode>();
  readonly fontSizeChange = output<-1 | 1>();
  readonly fontChange = output<string>();
  readonly gridDimensionChange = output<{ axis: 'columns' | 'rows'; delta: -1 | 1 }>();
  readonly gridSwapRequested = output<void>();

  protected readonly minGridDimension = MIN_TERMINAL_GRID_DIMENSION;
  protected readonly maxGridDimension = MAX_TERMINAL_GRID_DIMENSION;
  protected readonly minFontSize = MIN_TERMINAL_FONT_SIZE;
  protected readonly maxFontSize = MAX_TERMINAL_FONT_SIZE;

  /** The one open popover; they share the space beside the strip, so only one shows at a time. */
  protected readonly popover = signal<ToolbarPopover | null>(null);
  protected readonly gridCapacity = computed(() => this.gridColumns() * this.gridRows());
  protected readonly gridCells = computed(() => Array.from({ length: this.gridCapacity() }));

  protected togglePopover(popover: ToolbarPopover): void {
    this.popover.update((open) => (open === popover ? null : popover));
  }

  /**
   * Closes an open popover when the click lands outside this toolbar.
   *
   * Registered on the document rather than a backdrop element so it also closes when the click
   * goes to a terminal, which has no overlay to catch it.
   */
  @HostListener('document:pointerdown', ['$event'])
  protected closeOnOutsidePointer(event: PointerEvent): void {
    const target = event.target;
    if (this.popover() && target instanceof Node && !this.host.nativeElement.contains(target)) {
      this.popover.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    this.popover.set(null);
  }
}
