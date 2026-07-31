import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import { Workspace } from '../models/workspace.models';
import { isTauriRuntime } from './tauri-runtime';

const STORAGE_KEY = 'termexo.workspaces.v1';
const LEGACY_STORAGE_KEY = 'agentdock.workspaces.v1';

@Injectable({ providedIn: 'root' })
export class WorkspaceRepository {
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

  async saveAll(workspaces: Workspace[]): Promise<void> {
    if (isTauriRuntime()) {
      await Promise.all(workspaces.map((workspace) => this.save(workspace)));
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  async delete(workspaceId: string): Promise<void> {
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
  }
}
