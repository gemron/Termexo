import { computed, Injectable, signal } from '@angular/core';

import { WORKSPACE_ICON_OPTIONS, Workspace } from '../models/workspace.models';

const STORAGE_KEY = 'termexo.workspace-organization.v1';

export interface WorkspaceFolder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  collapsed: boolean;
}

export interface WorkspaceOrganizationEntry {
  folderId: string | null;
  tags: string[];
  icon: string | null;
  sortOrder: number;
}

export interface WorkspaceOrganizationData {
  version: 1;
  folders: WorkspaceFolder[];
  workspaces: Record<string, WorkspaceOrganizationEntry>;
}

export interface WorkspaceTreeEntry {
  kind: 'folder' | 'workspace';
  id: string;
  level: number;
  folder?: WorkspaceFolder;
  workspace?: Workspace;
}

interface SiblingItem {
  kind: 'folder' | 'workspace';
  id: string;
  sortOrder: number;
}

function emptyOrganization(): WorkspaceOrganizationData {
  return { version: 1, folders: [], workspaces: {} };
}

function folderIdFor(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeEntry(value: unknown, fallbackOrder: number): WorkspaceOrganizationEntry {
  const raw =
    value && typeof value === 'object' ? (value as Partial<WorkspaceOrganizationEntry>) : {};
  const tags = Array.isArray(raw.tags)
    ? [
        ...new Set(
          raw.tags
            .filter((tag): tag is string => typeof tag === 'string')
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  return {
    folderId: folderIdFor(raw.folderId),
    tags,
    icon:
      typeof raw.icon === 'string' &&
      (WORKSPACE_ICON_OPTIONS as readonly string[]).includes(raw.icon)
        ? raw.icon
        : null,
    sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : fallbackOrder,
  };
}

function normalizeOrganization(value: unknown): WorkspaceOrganizationData {
  if (!value || typeof value !== 'object') return emptyOrganization();
  const raw = value as Partial<WorkspaceOrganizationData>;
  const folders = Array.isArray(raw.folders)
    ? raw.folders
        .filter(
          (folder): folder is WorkspaceFolder =>
            !!folder &&
            typeof folder.id === 'string' &&
            typeof folder.name === 'string' &&
            folder.name.trim().length > 0,
        )
        .map((folder, index) => ({
          id: folder.id,
          name: folder.name.trim(),
          parentId: folderIdFor(folder.parentId),
          sortOrder: Number.isFinite(folder.sortOrder) ? Number(folder.sortOrder) : index,
          collapsed: folder.collapsed === true,
        }))
    : [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  for (const folder of folders) {
    if (!folder.parentId || !folderIds.has(folder.parentId) || folder.parentId === folder.id) {
      folder.parentId = null;
      continue;
    }
    const visited = new Set([folder.id]);
    let parentId: string | null = folder.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        folder.parentId = null;
        break;
      }
      visited.add(parentId);
      parentId = folders.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
  }
  const workspaces: Record<string, WorkspaceOrganizationEntry> = {};
  if (raw.workspaces && typeof raw.workspaces === 'object') {
    for (const [id, entry] of Object.entries(raw.workspaces)) {
      workspaces[id] = normalizeEntry(entry, 0);
      if (workspaces[id].folderId && !folderIds.has(workspaces[id].folderId!)) {
        workspaces[id].folderId = null;
      }
    }
  }
  return { version: 1, folders, workspaces };
}

function createFolderId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `folder-${Date.now().toString(36)}-${random}`;
}

export function hasSiblingFolderName(
  folders: readonly WorkspaceFolder[],
  name: string,
  parentId: string | null,
  exceptId?: string,
): boolean {
  const normalized = name.trim().toLowerCase();
  return folders.some(
    (folder) =>
      folder.id !== exceptId &&
      folder.parentId === parentId &&
      folder.name.trim().toLowerCase() === normalized,
  );
}

@Injectable({ providedIn: 'root' })
export class WorkspaceOrganizationService {
  private readonly organizationState = signal<WorkspaceOrganizationData>(emptyOrganization());
  readonly organization = this.organizationState.asReadonly();
  readonly folders = computed(() => this.organizationState().folders);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY && event.newValue) {
          try {
            this.organizationState.set(normalizeOrganization(JSON.parse(event.newValue)));
          } catch {
            // An invalid update from another preview tab must not discard this tab's in-memory data.
          }
        }
      });
    }
  }

  initialize(workspaces: Workspace[]): void {
    let stored: WorkspaceOrganizationData;
    try {
      const value = typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
      stored = value ? normalizeOrganization(JSON.parse(value)) : emptyOrganization();
    } catch {
      stored = emptyOrganization();
    }

    const knownIds = new Set(workspaces.map((workspace) => workspace.id));
    const entries: Record<string, WorkspaceOrganizationEntry> = {};
    for (const [id, entry] of Object.entries(stored.workspaces)) {
      if (knownIds.has(id)) entries[id] = entry;
    }
    workspaces.forEach((workspace, index) => {
      entries[workspace.id] ??= normalizeEntry(undefined, workspace.sortOrder ?? index);
    });

    const next = { ...stored, workspaces: entries };
    this.organizationState.set(next);
    this.persist(next);
  }

  entryFor(workspaceId: string): WorkspaceOrganizationEntry {
    return (
      this.organizationState().workspaces[workspaceId] ??
      normalizeEntry(undefined, Number.MAX_SAFE_INTEGER)
    );
  }

  orderWorkspaces(workspaces: Workspace[]): Workspace[] {
    const current = this.organizationState();
    const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const ordered: Workspace[] = [];
    const visited = new Set<string>();
    const visit = (parentId: string | null): void => {
      for (const item of this.siblingItems(current, parentId)) {
        if (item.kind === 'folder') {
          visit(item.id);
        } else {
          const workspace = byId.get(item.id);
          if (workspace) {
            visited.add(item.id);
            ordered.push(workspace);
          }
        }
      }
    };
    visit(null);
    for (const workspace of workspaces) {
      if (!visited.has(workspace.id)) ordered.push(workspace);
    }
    return ordered;
  }

  folderPath(folderId: string | null): string[] {
    const folders = this.organizationState().folders;
    const path: string[] = [];
    let current = folderId ? folders.find((folder) => folder.id === folderId) : undefined;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift(current.name);
      current = current.parentId
        ? folders.find((folder) => folder.id === current!.parentId)
        : undefined;
    }
    return path;
  }

  ensureWorkspaces(workspaces: Workspace[]): void {
    const current = this.organizationState();
    let changed = false;
    const entries = { ...current.workspaces };
    workspaces.forEach((workspace, index) => {
      if (!(workspace.id in entries)) {
        entries[workspace.id] = normalizeEntry(undefined, workspace.sortOrder ?? index);
        changed = true;
      }
    });
    for (const id of Object.keys(entries)) {
      if (!workspaces.some((workspace) => workspace.id === id)) {
        delete entries[id];
        changed = true;
      }
    }
    if (changed) this.commit({ ...current, workspaces: entries });
  }

  updateWorkspace(workspaceId: string, patch: { tags?: string[]; icon?: string | null }): void {
    const current = this.organizationState();
    const entry = this.entryFor(workspaceId);
    const nextEntry = normalizeEntry({ ...entry, ...patch }, entry.sortOrder);
    this.commit({
      ...current,
      workspaces: { ...current.workspaces, [workspaceId]: nextEntry },
    });
  }

  createFolder(name: string, parentId: string | null = null): WorkspaceFolder | null {
    const normalizedName = name.trim();
    const current = this.organizationState();
    if (
      !normalizedName ||
      hasSiblingFolderName(current.folders, normalizedName, parentId) ||
      (parentId && !current.folders.some((folder) => folder.id === parentId))
    ) {
      return null;
    }
    const siblings = this.siblingItems(current, parentId);
    const folder: WorkspaceFolder = {
      id: createFolderId(),
      name: normalizedName,
      parentId,
      sortOrder: siblings.length,
      collapsed: false,
    };
    this.commit(
      this.expandAncestors({ ...current, folders: [...current.folders, folder] }, parentId),
    );
    return folder;
  }

  renameFolder(folderId: string, name: string): boolean {
    const normalizedName = name.trim();
    if (!normalizedName) return false;
    const current = this.organizationState();
    const folder = current.folders.find((folder) => folder.id === folderId);
    if (!folder || hasSiblingFolderName(current.folders, normalizedName, folder.parentId, folderId))
      return false;
    this.commit({
      ...current,
      folders: current.folders.map((folder) =>
        folder.id === folderId ? { ...folder, name: normalizedName } : folder,
      ),
    });
    return true;
  }

  toggleFolder(folderId: string): void {
    const current = this.organizationState();
    this.commit({
      ...current,
      folders: current.folders.map((folder) =>
        folder.id === folderId ? { ...folder, collapsed: !folder.collapsed } : folder,
      ),
    });
  }

  deleteFolder(folderId: string): boolean {
    const current = this.organizationState();
    const removed = current.folders.find((folder) => folder.id === folderId);
    if (!removed) return false;
    const folders = current.folders
      .filter((folder) => folder.id !== folderId)
      .map((folder) =>
        folder.parentId === folderId ? { ...folder, parentId: removed.parentId } : folder,
      );
    const workspaces = { ...current.workspaces };
    for (const [id, entry] of Object.entries(workspaces)) {
      if (entry.folderId === folderId) {
        workspaces[id] = { ...entry, folderId: removed.parentId };
      }
    }
    const reparented = { ...current, folders, workspaces };
    const previousContents = this.siblingItems(current, folderId);
    const parentContents = this.siblingItems(current, removed.parentId).flatMap((item) =>
      item.kind === 'folder' && item.id === folderId ? previousContents : [item],
    );
    const next = this.applySiblingOrder(reparented, removed.parentId, parentContents);
    this.commit(next);
    return true;
  }

  moveWorkspaceToFolder(workspaceId: string, folderId: string | null): boolean {
    const current = this.organizationState();
    if (!current.workspaces[workspaceId]) return false;
    if (folderId && !current.folders.some((folder) => folder.id === folderId)) return false;
    const entry = this.entryFor(workspaceId);
    if (entry.folderId === folderId) return false;
    const workspaces = {
      ...current.workspaces,
      [workspaceId]: { ...entry, folderId, sortOrder: this.siblingItems(current, folderId).length },
    };
    const afterSource = this.renumberParent({ ...current, workspaces }, entry.folderId);
    const next = this.renumberParent(afterSource, folderId);
    this.commit(this.expandAncestors(next, folderId));
    return true;
  }

  reorderWorkspace(
    workspaceId: string,
    targetWorkspaceId: string,
    position: 'before' | 'after',
    allWorkspaces: Workspace[],
  ): boolean {
    if (workspaceId === targetWorkspaceId) return false;
    const current = this.organizationState();
    const moved = this.entryFor(workspaceId);
    const target = current.workspaces[targetWorkspaceId];
    if (!target || !allWorkspaces.some((workspace) => workspace.id === targetWorkspaceId))
      return false;
    const nextData =
      moved.folderId === target.folderId
        ? current
        : {
            ...current,
            workspaces: {
              ...current.workspaces,
              [workspaceId]: { ...moved, folderId: target.folderId },
            },
          };
    let next = this.reorderSibling(
      nextData,
      target.folderId,
      'workspace',
      workspaceId,
      targetWorkspaceId,
      position,
    );
    if (next === nextData && moved.folderId === target.folderId) return false;
    if (moved.folderId !== target.folderId) {
      next = this.renumberParent(next, moved.folderId);
    }
    this.commit(next);
    return true;
  }

  moveWorkspace(workspaceId: string, direction: -1 | 1, allWorkspaces: Workspace[]): boolean {
    const current = this.organizationState();
    const entry = this.entryFor(workspaceId);
    const siblings = this.siblingItems(current, entry.folderId).filter(
      (item) =>
        item.kind === 'workspace' && allWorkspaces.some((workspace) => workspace.id === item.id),
    );
    const index = siblings.findIndex((item) => item.id === workspaceId);
    const target = siblings[index + direction];
    if (index < 0 || !target) return false;
    return this.reorderWorkspace(
      workspaceId,
      target.id,
      direction < 0 ? 'before' : 'after',
      allWorkspaces,
    );
  }

  moveFolder(
    folderId: string,
    targetFolderId: string | null,
    position?: 'before' | 'after',
  ): boolean {
    const current = this.organizationState();
    const moved = current.folders.find((folder) => folder.id === folderId);
    if (!moved || targetFolderId === folderId) return false;
    if (targetFolderId && !current.folders.some((folder) => folder.id === targetFolderId))
      return false;
    const target = current.folders.find((folder) => folder.id === targetFolderId);
    const parentId = target && position ? target.parentId : targetFolderId;
    if (
      parentId === folderId ||
      (parentId && this.isDescendant(current.folders, folderId, parentId))
    )
      return false;
    if (hasSiblingFolderName(current.folders, moved.name, parentId, folderId)) return false;
    if (moved.parentId === parentId && !position) return false;

    const folders = current.folders.map((folder) =>
      folder.id === folderId
        ? { ...folder, parentId, sortOrder: this.siblingItems(current, parentId).length }
        : folder,
    );
    let next = { ...current, folders };
    if (target && position) {
      next = this.reorderSibling(next, parentId, 'folder', folderId, target.id, position);
    }
    next = this.renumberParent(next, moved.parentId);
    next = this.renumberParent(next, parentId);
    this.commit(this.expandAncestors(next, parentId));
    return true;
  }

  private expandAncestors(
    data: WorkspaceOrganizationData,
    folderId: string | null,
  ): WorkspaceOrganizationData {
    const ancestors = new Set<string>();
    let current = folderId;
    while (current && !ancestors.has(current)) {
      ancestors.add(current);
      current = data.folders.find((folder) => folder.id === current)?.parentId ?? null;
    }
    return {
      ...data,
      folders: data.folders.map((folder) =>
        ancestors.has(folder.id) ? { ...folder, collapsed: false } : folder,
      ),
    };
  }

  moveFolderToRoot(folderId: string): boolean {
    return this.moveFolder(folderId, null);
  }

  private reorderSibling(
    data: WorkspaceOrganizationData,
    parentId: string | null,
    targetKind: 'folder' | 'workspace',
    movedId: string,
    targetId: string,
    position: 'before' | 'after',
  ): WorkspaceOrganizationData {
    const siblings = this.siblingItems(data, parentId).filter(
      (item) => !(item.kind === targetKind && item.id === movedId),
    );
    const targetIndex = siblings.findIndex(
      (item) => item.kind === targetKind && item.id === targetId,
    );
    if (targetIndex < 0) return data;
    siblings.splice(targetIndex + (position === 'after' ? 1 : 0), 0, {
      kind: targetKind,
      id: movedId,
      sortOrder: 0,
    });
    const before = this.siblingItems(data, parentId);
    if (
      siblings.every(
        (item, index) => item.kind === before[index]?.kind && item.id === before[index]?.id,
      )
    ) {
      return data;
    }
    return this.applySiblingOrder(data, parentId, siblings);
  }

  private renumberParent(
    data: WorkspaceOrganizationData,
    parentId: string | null,
    appendMovedFolders = false,
  ): WorkspaceOrganizationData {
    let siblings = this.siblingItems(data, parentId);
    if (appendMovedFolders) {
      siblings = siblings.sort((left, right) => left.sortOrder - right.sortOrder);
    }
    return this.applySiblingOrder(data, parentId, siblings);
  }

  private applySiblingOrder(
    data: WorkspaceOrganizationData,
    parentId: string | null,
    siblings: SiblingItem[],
  ): WorkspaceOrganizationData {
    const order = new Map(siblings.map((item, index) => [`${item.kind}:${item.id}`, index]));
    return {
      ...data,
      folders: data.folders.map((folder) =>
        folder.parentId === parentId
          ? { ...folder, sortOrder: order.get(`folder:${folder.id}`) ?? folder.sortOrder }
          : folder,
      ),
      workspaces: Object.fromEntries(
        Object.entries(data.workspaces).map(([id, entry]) => [
          id,
          entry.folderId === parentId
            ? { ...entry, sortOrder: order.get(`workspace:${id}`) ?? entry.sortOrder }
            : entry,
        ]),
      ),
    };
  }

  private siblingItems(data: WorkspaceOrganizationData, parentId: string | null): SiblingItem[] {
    return [
      ...data.folders
        .filter((folder) => folder.parentId === parentId)
        .map((folder) => ({ kind: 'folder' as const, id: folder.id, sortOrder: folder.sortOrder })),
      ...Object.entries(data.workspaces)
        .filter(([, entry]) => entry.folderId === parentId)
        .map(([id, entry]) => ({ kind: 'workspace' as const, id, sortOrder: entry.sortOrder })),
    ].sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private isDescendant(folders: WorkspaceFolder[], parentId: string, candidateId: string): boolean {
    let current = folders.find((folder) => folder.id === candidateId);
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (current.parentId === parentId) return true;
      visited.add(current.id);
      current = current.parentId
        ? folders.find((folder) => folder.id === current!.parentId)
        : undefined;
    }
    return false;
  }

  private commit(next: WorkspaceOrganizationData): void {
    const normalized = normalizeOrganization(next);
    this.organizationState.set(normalized);
    this.persist(normalized);
  }

  private persist(data: WorkspaceOrganizationData): void {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    } catch {
      // The current session keeps working when browser storage is unavailable.
    }
  }
}
