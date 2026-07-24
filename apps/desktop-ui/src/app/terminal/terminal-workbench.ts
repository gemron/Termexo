import { Component, input, output } from '@angular/core';

import { LayoutMode, TerminalSession } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';
import { TerminalPanelComponent } from './terminal-panel';

@Component({
  selector: 'app-terminal-workbench',
  imports: [IconComponent, TerminalPanelComponent],
  templateUrl: './terminal-workbench.html',
  styleUrl: './terminal-workbench.scss',
})
export class TerminalWorkbenchComponent {
  readonly terminals = input.required<TerminalSession[]>();
  readonly layout = input.required<LayoutMode>();
  readonly activeTerminalId = input<string | null>(null);

  readonly terminalSelected = output<string>();
  readonly terminalClosed = output<string>();
  readonly terminalRequested = output<void>();
}
