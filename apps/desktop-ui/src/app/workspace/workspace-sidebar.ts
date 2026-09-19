import { Component, computed, input, output, signal } from '@angular/core';

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
  readonly reorderRequested = output<{
    workspaceId: string;
    targetWorkspaceId: string;
    position: 'before' | 'after';
  }>();
  readonly createRequested = output<void>();

  protected readonly openActions = signal<string | null>(null);
  protected readonly draggedWorkspaceId = signal<string | null>(null);
  protected readonly dropTarget = signal<{
    workspaceId: string;
    position: 'before' | 'after';
  } | null>(null);
  protected readonly search = signal('');
  protected readonly visibleWorkspaces = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.workspaces().filter((workspace) =>
      `${workspace.name} ${workspace.projectPath} ${workspace.activeBranch}`
        .toLocaleLowerCase()
        .includes(query),
    );
  });

  protected workspaceColor(workspace: Workspace): string {
    return normalizeWorkspaceThemeColor(workspace.themeColor);
  }

  protected startWorkspaceDrag(event: DragEvent, workspaceId: string): void {
    this.openActions.set(null);
    this.draggedWorkspaceId.set(workspaceId);
    this.dropTarget.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', workspaceId);
    }
  }

  protected dragOverWorkspace(event: DragEvent, workspaceId: string): void {
    const draggedId = this.draggedWorkspaceId();
    if (!draggedId || draggedId === workspaceId) {
      this.dropTarget.set(null);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.dropTarget.set({
      workspaceId,
      position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
    });
  }

  protected dropWorkspace(event: DragEvent, targetWorkspaceId: string): void {
    const workspaceId = this.draggedWorkspaceId();
    const target = this.dropTarget();
    this.endWorkspaceDrag();
    if (!workspaceId || !target || target.workspaceId !== targetWorkspaceId) return;
    event.preventDefault();
    this.reorderRequested.emit({ workspaceId, targetWorkspaceId, position: target.position });
  }

  protected endWorkspaceDrag(): void {
    this.draggedWorkspaceId.set(null);
    this.dropTarget.set(null);
  }

  protected moveWorkspaceWithKeyboard(event: KeyboardEvent, workspaceId: string): void {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : null;
    if (!direction) return;
    event.preventDefault();
    this.moveRequested.emit({ workspaceId, direction });
  }

  protected requestActiveWorkspaceMerge(): void {
    const workspaceId = this.activeWorkspaceId();
    if (workspaceId && this.workspaces().length > 1) {
      this.mergeRequested.emit(workspaceId);
    }
  }
}
