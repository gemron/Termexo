import {
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import {
  AGENT_ICONS,
  normalizeWorkspaceThemeColor,
  TERMINAL_STATUS_META,
  TerminalSession,
  Workspace,
} from '../core/models/workspace.models';
import {
  WorkspaceFolder,
  WorkspaceOrganizationData,
  WorkspaceTreeEntry,
  hasSiblingFolderName,
} from '../core/services/workspace-organization.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { IconComponent } from '../shared/icon/icon';

type DragEntry = { kind: 'folder' | 'workspace'; id: string };
type FolderEditor = {
  mode: 'create' | 'rename';
  parentId: string | null;
  folderId?: string;
  value: string;
};

@Component({
  selector: 'app-workspace-sidebar',
  imports: [IconComponent, TranslatePipe],
  templateUrl: './workspace-sidebar.html',
  styleUrl: './workspace-sidebar.scss',
})
export class WorkspaceSidebarComponent {
  protected readonly agentIcons = AGENT_ICONS;
  protected readonly statusMeta = TERMINAL_STATUS_META;
  readonly workspaces = input.required<Workspace[]>();
  readonly organization = input<WorkspaceOrganizationData>({
    version: 1,
    folders: [],
    workspaces: {},
  });
  readonly activeWorkspaceId = input<string | null>(null);
  /** Empty in browser preview, where the footer is left out entirely. */
  readonly appVersion = input('');

  readonly workspaceSelected = output<string>();
  readonly favoriteToggled = output<string>();
  readonly editRequested = output<string>();
  readonly directoryOpenRequested = output<string>();
  readonly canOpenDirectory = input(false);
  readonly mergeRequested = output<string>();
  readonly deleteRequested = output<string>();
  readonly moveRequested = output<{ workspaceId: string; direction: -1 | 1 }>();
  readonly reorderRequested = output<{
    workspaceId: string;
    targetWorkspaceId: string;
    position: 'before' | 'after';
  }>();
  readonly createRequested = output<void>();
  readonly folderCreateRequested = output<{ name: string; parentId: string | null }>();
  readonly folderRenameRequested = output<{ folderId: string; name: string }>();
  readonly folderDeleteRequested = output<string>();
  readonly folderToggleRequested = output<string>();
  readonly workspaceFolderRequested = output<{ workspaceId: string; folderId: string | null }>();
  readonly folderMoveRequested = output<{
    folderId: string;
    targetFolderId: string | null;
    position?: 'before' | 'after';
  }>();

  protected readonly openActions = signal<string | null>(null);
  protected readonly openFolderActions = signal<string | null>(null);
  protected readonly draggedEntry = signal<DragEntry | null>(null);
  protected readonly dropTarget = signal<{
    kind: 'folder' | 'workspace';
    id: string;
    position: 'before' | 'after' | 'inside';
  } | null>(null);
  protected readonly folderEditor = signal<FolderEditor | null>(null);
  protected readonly folderPendingDeletion = signal<string | null>(null);
  private readonly folderNameInput = viewChild<ElementRef<HTMLInputElement>>('folderNameInput');
  protected readonly search = signal('');
  protected readonly selectedTags = signal<string[]>([]);

  constructor() {
    effect(() => {
      const input = this.folderNameInput()?.nativeElement;
      input?.focus();
      input?.select();
    });
  }

  protected readonly folderOptions = computed(() => {
    const folders = this.organization().folders;
    const options: { id: string; label: string }[] = [];
    const visited = new Set<string>();
    const walk = (parentId: string | null, path: string[]): void => {
      for (const folder of folders
        .filter((item) => item.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)) {
        if (visited.has(folder.id)) continue;
        visited.add(folder.id);
        const names = [...path, folder.name];
        options.push({ id: folder.id, label: names.join(' / ') });
        walk(folder.id, names);
      }
    };
    walk(null, []);
    return options;
  });

  protected readonly folderNameError = computed(() => {
    const editor = this.folderEditor();
    return editor?.value.trim() &&
      hasSiblingFolderName(
        this.organization().folders,
        editor.value,
        editor.parentId,
        editor.folderId,
      )
      ? 'workspace.folderNameExists'
      : null;
  });

  protected folderIsEmpty(folderId: string): boolean {
    const organization = this.organization();
    return (
      !organization.folders.some((folder) => folder.parentId === folderId) &&
      !this.workspaces().some(
        (workspace) => organization.workspaces[workspace.id]?.folderId === folderId,
      )
    );
  }

  protected canMoveFolderTo(folder: WorkspaceFolder, parentId: string | null): boolean {
    if (hasSiblingFolderName(this.organization().folders, folder.name, parentId, folder.id))
      return false;
    let ancestor = parentId;
    const visited = new Set<string>();
    while (ancestor && !visited.has(ancestor)) {
      if (ancestor === folder.id) return false;
      visited.add(ancestor);
      ancestor = this.organization().folders.find((item) => item.id === ancestor)?.parentId ?? null;
    }
    return true;
  }

  protected moveFolderFromMenu(folderId: string, event: Event): void {
    this.folderMoveRequested.emit({
      folderId,
      targetFolderId: (event.target as HTMLSelectElement).value || null,
    });
    this.openFolderActions.set(null);
  }

  protected moveWorkspaceFromMenu(workspaceId: string, event: Event): void {
    this.workspaceFolderRequested.emit({
      workspaceId,
      folderId: (event.target as HTMLSelectElement).value || null,
    });
    this.openActions.set(null);
  }

  protected toggleFolderActions(folderId: string): void {
    this.openActions.set(null);
    this.folderPendingDeletion.set(null);
    this.openFolderActions.update((id) => (id === folderId ? null : folderId));
  }

  protected toggleWorkspaceActions(workspaceId: string): void {
    this.openFolderActions.set(null);
    this.folderPendingDeletion.set(null);
    this.openActions.update((id) => (id === workspaceId ? null : workspaceId));
  }

  @HostListener('document:pointerdown', ['$event'])
  protected closeMenusOnOutsidePointer(event: PointerEvent): void {
    if (
      event.target instanceof Element &&
      !event.target.closest('.workspace-actions, .workspace-more')
    ) {
      this.closeMenus();
    }
  }

  @HostListener('document:keydown.escape')
  protected closeMenus(): void {
    this.openActions.set(null);
    this.openFolderActions.set(null);
    this.folderPendingDeletion.set(null);
  }

  protected readonly tagFilters = computed(() => {
    const counts = new Map<string, number>();
    for (const workspace of this.workspaces()) {
      for (const tag of this.organization().workspaces[workspace.id]?.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => left.name.localeCompare(right.name));
  });

  protected readonly treeEntries = computed<WorkspaceTreeEntry[]>(() => {
    const workspaces = this.workspaces();
    const organization = this.organization();
    const folders = organization.folders;
    const query = this.search().trim().toLocaleLowerCase();
    const selectedTags = this.selectedTags();
    const filtering = Boolean(query || selectedTags.length);
    const folderPath = (folderId: string | null): string[] => {
      const path: string[] = [];
      const visited = new Set<string>();
      let current = folderId ? folders.find((folder) => folder.id === folderId) : undefined;
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        path.unshift(current.name);
        current = current.parentId
          ? folders.find((folder) => folder.id === current!.parentId)
          : undefined;
      }
      return path;
    };
    const workspaceMatches = (workspace: Workspace, forceTextMatch: boolean): boolean => {
      const entry = organization.workspaces[workspace.id];
      const tags = entry?.tags ?? [];
      return (
        selectedTags.every((tag) => tags.includes(tag)) &&
        (!query ||
          forceTextMatch ||
          `${workspace.name} ${workspace.projectPath} ${tags.join(' ')} ${folderPath(entry?.folderId ?? null).join(' ')}`
            .toLocaleLowerCase()
            .includes(query))
      );
    };

    const walk = (
      parentId: string | null,
      level: number,
      forceTextMatch = false,
    ): WorkspaceTreeEntry[] => {
      const children = [
        ...folders
          .filter((folder) => folder.parentId === parentId)
          .map((folder) => ({
            kind: 'folder' as const,
            id: folder.id,
            sortOrder: folder.sortOrder,
            folder,
          })),
        ...workspaces
          .filter(
            (workspace) => (organization.workspaces[workspace.id]?.folderId ?? null) === parentId,
          )
          .map((workspace) => ({
            kind: 'workspace' as const,
            id: workspace.id,
            sortOrder: organization.workspaces[workspace.id]?.sortOrder ?? workspace.sortOrder ?? 0,
            workspace,
          })),
      ].sort((left, right) => left.sortOrder - right.sortOrder);
      const result: WorkspaceTreeEntry[] = [];

      for (const child of children) {
        if (child.kind === 'workspace') {
          if (!workspaceMatches(child.workspace, forceTextMatch)) continue;
          result.push({ kind: 'workspace', id: child.id, level, workspace: child.workspace });
          continue;
        }

        const path = [...folderPath(child.folder.parentId), child.folder.name];
        const folderMatches = Boolean(query && path.join(' ').toLocaleLowerCase().includes(query));
        const forceChildren = forceTextMatch || folderMatches;
        const includeChildren = !child.folder.collapsed || filtering || forceChildren;
        const descendants = includeChildren ? walk(child.id, level + 1, forceChildren) : [];
        if (!filtering || forceTextMatch || folderMatches || descendants.length > 0) {
          result.push({ kind: 'folder', id: child.id, level, folder: child.folder });
          result.push(...descendants);
        }
      }
      return result;
    };

    return walk(null, 0);
  });

  protected workspaceColor(workspace: Workspace): string {
    return normalizeWorkspaceThemeColor(workspace.themeColor);
  }

  protected workspaceIcon(workspace: Workspace): string {
    return this.organization().workspaces[workspace.id]?.icon ?? 'folder';
  }

  protected workspaceTags(workspace: Workspace): string[] {
    return this.organization().workspaces[workspace.id]?.tags ?? [];
  }

  protected agentTerminals(workspace: Workspace): TerminalSession[] {
    return workspace.terminals.filter((terminal) => terminal.agentType !== 'shell');
  }

  protected toggleTag(tag: string): void {
    const selected = this.selectedTags();
    this.selectedTags.set(
      selected.includes(tag) ? selected.filter((item) => item !== tag) : [...selected, tag],
    );
  }

  protected startEntryDrag(event: DragEvent, kind: 'folder' | 'workspace', id: string): void {
    this.openActions.set(null);
    this.openFolderActions.set(null);
    this.draggedEntry.set({ kind, id });
    this.dropTarget.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `${kind}:${id}`);
    }
  }

  protected dragOverEntry(event: DragEvent, kind: 'folder' | 'workspace', id: string): void {
    const dragged = this.draggedEntry();
    if (!dragged || (dragged.kind === kind && dragged.id === id)) {
      this.dropTarget.set(null);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    this.dropTarget.set({
      kind,
      id,
      position:
        kind === 'folder'
          ? dragged.kind === 'workspace' || (ratio >= 0.25 && ratio <= 0.75)
            ? 'inside'
            : ratio < 0.25
              ? 'before'
              : 'after'
          : ratio < 0.5
            ? 'before'
            : 'after',
    });
  }

  protected dropOnWorkspace(event: DragEvent, targetWorkspaceId: string): void {
    const dragged = this.draggedEntry();
    const target = this.dropTarget();
    this.endDrag();
    if (
      !dragged ||
      dragged.kind !== 'workspace' ||
      !target ||
      target.kind !== 'workspace' ||
      target.position === 'inside' ||
      target.id !== targetWorkspaceId
    ) {
      return;
    }
    event.preventDefault();
    this.reorderRequested.emit({
      workspaceId: dragged.id,
      targetWorkspaceId,
      position: target.position,
    });
  }

  protected dropOnFolder(event: DragEvent, folderId: string): void {
    const dragged = this.draggedEntry();
    const target = this.dropTarget();
    this.endDrag();
    if (!dragged || !target || target.kind !== 'folder' || target.id !== folderId) return;
    event.preventDefault();
    if (dragged.kind === 'workspace') {
      this.workspaceFolderRequested.emit({ workspaceId: dragged.id, folderId });
      return;
    }
    this.folderMoveRequested.emit({
      folderId: dragged.id,
      targetFolderId: folderId,
      position: target.position === 'inside' ? undefined : target.position,
    });
  }

  protected dropOnRoot(event: DragEvent): void {
    event.preventDefault();
    const dragged = this.draggedEntry();
    this.endDrag();
    if (!dragged) return;
    if (dragged.kind === 'workspace') {
      this.workspaceFolderRequested.emit({ workspaceId: dragged.id, folderId: null });
    } else {
      this.folderMoveRequested.emit({ folderId: dragged.id, targetFolderId: null });
    }
  }

  protected endDrag(): void {
    this.draggedEntry.set(null);
    this.dropTarget.set(null);
  }

  protected beginFolderCreate(parentId: string | null = null): void {
    this.closeMenus();
    this.folderEditor.set({ mode: 'create', parentId, value: '' });
  }

  protected beginFolderRename(folder: WorkspaceFolder): void {
    this.closeMenus();
    this.folderEditor.set({
      mode: 'rename',
      parentId: folder.parentId,
      folderId: folder.id,
      value: folder.name,
    });
  }

  protected updateFolderEditor(event: Event): void {
    const editor = this.folderEditor();
    if (editor)
      this.folderEditor.set({ ...editor, value: (event.target as HTMLInputElement).value });
  }

  protected updateFolderParent(event: Event): void {
    const editor = this.folderEditor();
    if (editor)
      this.folderEditor.set({
        ...editor,
        parentId: (event.target as HTMLSelectElement).value || null,
      });
  }

  protected submitFolderEditor(): void {
    const editor = this.folderEditor();
    const name = editor?.value.trim();
    if (!editor || !name || this.folderNameError()) return;
    if (editor.mode === 'create') {
      this.folderCreateRequested.emit({ name, parentId: editor.parentId });
    } else if (editor.folderId) {
      this.folderRenameRequested.emit({ folderId: editor.folderId, name });
    }
    this.folderEditor.set(null);
    // A newly created group must be visible even when the previous search excluded it.
    this.search.set('');
    this.selectedTags.set([]);
  }

  protected cancelFolderEditor(): void {
    this.folderEditor.set(null);
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
