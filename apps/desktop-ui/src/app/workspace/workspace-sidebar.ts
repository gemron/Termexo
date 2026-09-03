import { Component, input, output } from '@angular/core';

import { normalizeWorkspaceThemeColor, Workspace } from '../core/models/workspace.models';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';

@Component({
  selector: 'app-workspace-sidebar',
  imports: [IconComponent, TranslatePipe],
  templateUrl: './workspace-sidebar.html',
  styleUrl: './workspace-sidebar.scss',
})
export class WorkspaceSidebarComponent {
  readonly workspaces = input.required<Workspace[]>();
  readonly activeWorkspaceId = input<string | null>(null);
  /** Empty in browser preview, where the footer is left out entirely. */
  readonly appVersion = input('');

  readonly workspaceSelected = output<string>();
  readonly favoriteToggled = output<string>();
  readonly editRequested = output<string>();
  readonly mergeRequested = output<string>();
  readonly deleteRequested = output<string>();
  readonly moveRequested = output<{ workspaceId: string; direction: -1 | 1 }>();
  readonly createRequested = output<void>();

  protected workspaceColor(workspace: Workspace): string {
    return normalizeWorkspaceThemeColor(workspace.themeColor);
  }

  protected requestActiveWorkspaceMerge(): void {
    const workspaceId = this.activeWorkspaceId();
    if (workspaceId && this.workspaces().length > 1) {
      this.mergeRequested.emit(workspaceId);
    }
  }
}
