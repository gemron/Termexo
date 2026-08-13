import { Component, computed, input, output } from '@angular/core';

import {
  DEFAULT_TERMINAL_GRID_DIMENSION,
  LayoutMode,
  normalizeTerminalGridDimension,
  TerminalSession,
  TerminalStatus,
} from '../core/models/workspace.models';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';
import { DEFAULT_TERMINAL_FONT_NAME } from './terminal-font';
import { TerminalPanelComponent } from './terminal-panel';

@Component({
  selector: 'app-terminal-workbench',
  imports: [IconComponent, TerminalPanelComponent, TranslatePipe],
  templateUrl: './terminal-workbench.html',
  styleUrl: './terminal-workbench.scss',
})
export class TerminalWorkbenchComponent {
  readonly terminals = input.required<TerminalSession[]>();
  readonly layout = input.required<LayoutMode>();
  readonly activeTerminalId = input<string | null>(null);
  readonly visibleTerminalIds = input<string[]>([]);
  readonly terminalMaximized = input(false);
  readonly layoutRevision = input(0);
  readonly terminalFontSize = input(12);
  readonly terminalFontName = input(DEFAULT_TERMINAL_FONT_NAME);
  readonly themeColor = input<string>();
  readonly gridColumns = input(DEFAULT_TERMINAL_GRID_DIMENSION);
  readonly gridRows = input(DEFAULT_TERMINAL_GRID_DIMENSION);

  readonly terminalSelected = output<string>();
  readonly terminalClosed = output<string>();
  readonly terminalMaximizeRequested = output<string>();
  readonly terminalRequested = output<void>();
  readonly terminalStatusChanged = output<{ terminalId: string; status: TerminalStatus }>();
  readonly terminalRenamed = output<{ terminalId: string; name: string }>();
  readonly terminalModelSwitchRequested = output<string>();
  readonly terminalInput = output<{ terminalId: string; data: string }>();
  readonly terminalOutput = output<{ terminalId: string; data: string }>();

  protected readonly renderedGridColumns = computed(() =>
    Math.min(
      normalizeTerminalGridDimension(this.gridColumns()),
      Math.max(1, this.visibleTerminalIds().length),
    ),
  );
  protected readonly renderedGridRows = computed(() =>
    Math.min(
      normalizeTerminalGridDimension(this.gridRows()),
      Math.max(1, Math.ceil(this.visibleTerminalIds().length / this.renderedGridColumns())),
    ),
  );

  protected isVisible(terminalId: string): boolean {
    return this.visibleTerminalIds().includes(terminalId);
  }
}
