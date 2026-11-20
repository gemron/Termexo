import {
  Component,
  computed,
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
import { AnchoredMenuDirective } from '../shared/anchored-menu.directive';
import { IconComponent } from '../shared/icon/icon';
import { DEFAULT_TERMINAL_FONT_NAME } from './terminal-font';
import { TerminalFontPickerComponent } from './terminal-font-picker';

@Component({
  selector: 'app-terminal-toolbar',
  imports: [AnchoredMenuDirective, IconComponent, TerminalFontPickerComponent, TranslatePipe],
  templateUrl: './terminal-toolbar.html',
  styleUrl: './terminal-toolbar.scss',
})
export class TerminalToolbarComponent {
  readonly visibleCount = input.required<number>();
  readonly visibleLimit = input.required<number>();
  readonly terminalCount = input.required<number>();
  readonly layout = input.required<LayoutMode>();
  readonly gridColumns = input.required<number>();
  readonly gridRows = input.required<number>();
  readonly fontSize = input.required<number>();
  readonly fontName = input(DEFAULT_TERMINAL_FONT_NAME);
  /** Drops the controls that only steer split layouts, which a phone cannot draw. */
  readonly compact = input(false);

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

  protected readonly open = signal(false);
  protected readonly gridCapacity = computed(() => this.gridColumns() * this.gridRows());

  protected close(trigger: HTMLButtonElement): void {
    trigger.focus({ preventScroll: true });
    this.open.set(false);
  }
}
