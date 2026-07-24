import { Component, input, output } from '@angular/core';

import { Workspace } from '../core/models/workspace.models';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-workspace-sidebar',
  imports: [IconComponent],
  templateUrl: './workspace-sidebar.html',
  styleUrl: './workspace-sidebar.scss',
})
export class WorkspaceSidebarComponent {
  readonly workspaces = input.required<Workspace[]>();
  readonly activeWorkspaceId = input<string | null>(null);

  readonly workspaceSelected = output<string>();
  readonly favoriteToggled = output<string>();
  readonly createRequested = output<void>();
  readonly settingsRequested = output<void>();
}
