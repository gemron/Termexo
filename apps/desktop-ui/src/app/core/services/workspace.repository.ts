import { Injectable } from '@angular/core';

import { Workspace } from '../models/workspace.models';
import { invoke, listen, UnlistenFn } from './backend-bridge';
import { hasBackend, runtimeClientId } from './tauri-runtime';

const STORAGE_KEY = 'termexo.workspaces.v1';
const LEGACY_STORAGE_KEY = 'agentdock.workspaces.v1';

const WORKSPACE_CHANGED_EVENT = 'workspace-changed';
const WORKSPACE_DELETED_EVENT = 'workspace-deleted';

interface WorkspaceChangedPayload {
  workspace: Workspace;
  originId?: string | null;
}

interface WorkspaceDeletedPayload {
  workspaceId: string;
  originId?: string | null;
}

/** Applied when another client — the desktop window or a second browser — edits the same store. */
export interface WorkspaceChangeHandlers {
  changed: (workspace: Workspace) => void;
  deleted: (workspaceId: string) => void;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceRepository {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly deletedWorkspaceIds = new Set<string>();

  async list(): Promise<Workspace[]> {
    if (hasBackend()) {
      return invoke<Workspace[]>('list_workspaces');
    }

    const currentValue = localStorage.getItem(STORAGE_KEY);
    const value = currentValue ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!value) {
      return [];
    }

    try {
      const workspaces = JSON.parse(value) as Workspace[];
      if (currentValue === null) {
        localStorage.setItem(STORAGE_KEY, value);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      return workspaces;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return [];
    }
  }

  /**
   * Reports workspace writes made outside this client.
   *
   * Every write carries the id of the page that made it, so the event it triggers can be told
   * apart from a genuine external edit and this client does not re-apply its own change.
   */
  async watchChanges(handlers: WorkspaceChangeHandlers): Promise<UnlistenFn> {
    if (!hasBackend()) {
      return () => undefined;
    }

    const originId = runtimeClientId();
    const [unlistenChanged, unlistenDeleted] = await Promise.all([
      listen<WorkspaceChangedPayload>(WORKSPACE_CHANGED_EVENT, (event) => {
        if (event.payload.originId !== originId) {
          handlers.changed(event.payload.workspace);
        }
      }),
      listen<WorkspaceDeletedPayload>(WORKSPACE_DELETED_EVENT, (event) => {
        if (event.payload.originId !== originId) {
          handlers.deleted(event.payload.workspaceId);
        }
      }),
    ]);

    return () => {
      unlistenChanged();
      unlistenDeleted();
    };
  }

  async save(workspace: Workspace): Promise<void> {
    if (this.deletedWorkspaceIds.has(workspace.id)) {
      return;
    }

    await this.enqueueMutation(async () => {
      if (this.deletedWorkspaceIds.has(workspace.id)) {
        return;
      }

      await this.saveNow(workspace);
    });
  }

  async saveAll(workspaces: Workspace[]): Promise<void> {
    await this.enqueueMutation(async () => {
      const retainedWorkspaces = workspaces.filter(
        (workspace) => !this.deletedWorkspaceIds.has(workspace.id),
      );

      if (hasBackend()) {
        await Promise.all(retainedWorkspaces.map((workspace) => this.saveNow(workspace)));
        return;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(retainedWorkspaces));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    });
  }

  async delete(workspaceId: string): Promise<void> {
    // A terminal-exit event can arrive while deletion is in flight. Remembering the ID before the
    // queued delete starts prevents that delayed status save from recreating the workspace row.
    this.deletedWorkspaceIds.add(workspaceId);
    try {
      await this.enqueueMutation(async () => {
        if (hasBackend()) {
          await invoke('delete_workspace', { workspaceId, originId: runtimeClientId() });
          return;
        }

        const workspaces = await this.list();
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(workspaces.filter((workspace) => workspace.id !== workspaceId)),
        );
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      });
    } catch (error) {
      this.deletedWorkspaceIds.delete(workspaceId);
      throw error;
    }
  }

  private async saveNow(workspace: Workspace): Promise<void> {
    if (hasBackend()) {
      await invoke('save_workspace', { workspace, originId: runtimeClientId() });
      return;
    }

    const workspaces = await this.list();
    const existingIndex = workspaces.findIndex((item) => item.id === workspace.id);
    if (existingIndex >= 0) {
      workspaces[existingIndex] = workspace;
    } else {
      workspaces.push(workspace);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  private enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const next = this.mutationQueue.catch(() => undefined).then(operation);
    this.mutationQueue = next;
    return next;
  }
}
