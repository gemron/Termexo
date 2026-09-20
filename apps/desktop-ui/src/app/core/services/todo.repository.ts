import { Injectable } from '@angular/core';

import type { TodoWorkspaceSnapshot } from '../models/todo.models';
import { invoke, listen, type UnlistenFn } from './backend-bridge';
import { hasBackend, runtimeClientId } from './tauri-runtime';

export interface TodoSnapshotChange {
  workspaceId: string;
  snapshot: TodoWorkspaceSnapshot | null;
}

@Injectable({ providedIn: 'root' })
export class TodoRepository {
  enabled(): boolean {
    return hasBackend();
  }

  list(): Promise<TodoWorkspaceSnapshot[]> {
    return invoke('list_todo_snapshots');
  }

  save(snapshot: TodoWorkspaceSnapshot): Promise<void> {
    return invoke('save_todo_snapshot', { snapshot, originId: runtimeClientId() });
  }

  delete(workspaceId: string): Promise<void> {
    return invoke('delete_todo_snapshot', { workspaceId, originId: runtimeClientId() });
  }

  watch(onChange: (change: TodoSnapshotChange) => void): Promise<UnlistenFn> {
    return listen<TodoSnapshotChange & { originId?: string | null }>(
      'todo-snapshot-changed',
      (event) => {
        if (event.payload.originId !== runtimeClientId()) onChange(event.payload);
      },
    );
  }
}
