import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import { Workspace } from '../models/workspace.models';
import { isTauriRuntime } from './tauri-runtime';

const STORAGE_KEY = 'termexo.workspaces.v1';
const LEGACY_STORAGE_KEY = 'agentdock.workspaces.v1';

@Injectable({ providedIn: 'root' })
export class WorkspaceRepository {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly deletedWorkspaceIds = new Set<string>();

  async list(): Promise<Workspace[]> {
    if (isTauriRuntime()) {
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

      if (isTauriRuntime()) {
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
        if (isTauriRuntime()) {
          await invoke('delete_workspace', { workspaceId });
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
    if (isTauriRuntime()) {
      await invoke('save_workspace', { workspace });
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
