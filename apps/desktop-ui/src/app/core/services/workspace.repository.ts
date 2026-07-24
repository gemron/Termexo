import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

import { Workspace } from '../models/workspace.models';

const STORAGE_KEY = 'agentdock.workspaces.v1';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceRepository {
  async list(): Promise<Workspace[]> {
    if (isTauriRuntime()) {
      return invoke<Workspace[]>('list_workspaces');
    }

    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) {
      return [];
    }

    try {
      return JSON.parse(value) as Workspace[];
    } catch {
      localStorage.removeItem(STORAGE_KEY);
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
  }

  async saveAll(workspaces: Workspace[]): Promise<void> {
    if (isTauriRuntime()) {
      await Promise.all(workspaces.map((workspace) => this.save(workspace)));
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
  }
}
