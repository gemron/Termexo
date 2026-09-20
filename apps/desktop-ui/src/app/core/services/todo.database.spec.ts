import { beforeEach, describe, expect, it } from 'vitest';

import type { TodoWorkspaceSnapshot } from '../models/todo.models';
import type { Workspace } from '../models/workspace.models';
import { TodoRepository } from './todo.repository';
import { TodoService } from './todo.service';

class FakeTodoRepository extends TodoRepository {
  readonly snapshots = new Map<string, TodoWorkspaceSnapshot>();
  failSave = false;

  override enabled(): boolean {
    return true;
  }
  override async list(): Promise<TodoWorkspaceSnapshot[]> {
    return [...this.snapshots.values()].map((snapshot) => structuredClone(snapshot));
  }
  override async save(snapshot: TodoWorkspaceSnapshot): Promise<void> {
    if (this.failSave) throw new Error('database unavailable');
    this.snapshots.set(snapshot.workspaceId, structuredClone(snapshot));
  }
  override async delete(workspaceId: string): Promise<void> {
    this.snapshots.delete(workspaceId);
  }
  override async watch(): Promise<() => void> {
    return () => undefined;
  }
}

const workspace = {
  id: 'workspace-1',
  name: 'App',
  projectPath: 'D:/app',
  projectType: 'Local',
  activeBranch: 'main',
  favorite: false,
  lastOpenedAt: 1,
  layout: 'single',
  terminals: [],
} as Workspace;

describe('TodoService database persistence', () => {
  beforeEach(() => localStorage.clear());

  it('migrates legacy browser tasks and removes the legacy key after a database save', async () => {
    const repository = new FakeTodoRepository();
    const legacy: TodoWorkspaceSnapshot = {
      version: 1,
      workspaceId: workspace.id,
      projects: [
        {
          id: 'p',
          workspaceId: workspace.id,
          name: 'App',
          path: 'D:/app',
          color: '#fff',
          createdAt: 1,
        },
      ],
      tasks: [],
    };
    localStorage.setItem('termexo.todos.v1', JSON.stringify({ [workspace.id]: legacy }));
    const service = new TodoService(repository);
    await service.initialize([workspace]);

    expect(repository.snapshots.get(workspace.id)).toEqual(legacy);
    expect(localStorage.getItem('termexo.todos.v1')).toBeNull();
    service.createProject(workspace.id, { name: 'Website', path: 'D:/app/site' });
    await service.flush();
    expect(repository.snapshots.get(workspace.id)?.projects).toHaveLength(2);
  });

  it('treats SQLite as authoritative when old local storage is stale', async () => {
    const repository = new FakeTodoRepository();
    const database: TodoWorkspaceSnapshot = {
      version: 1,
      workspaceId: workspace.id,
      projects: [
        {
          id: 'db',
          workspaceId: workspace.id,
          name: 'Saved',
          path: 'D:/saved',
          color: '#fff',
          createdAt: 1,
        },
      ],
      tasks: [],
    };
    repository.snapshots.set(workspace.id, database);
    localStorage.setItem(
      'termexo.todos.v1',
      JSON.stringify({
        [workspace.id]: { ...database, projects: [{ ...database.projects[0], id: 'stale' }] },
      }),
    );

    const service = new TodoService(repository);
    await service.initialize([workspace]);
    expect(service.projectsFor(workspace.id)[0].id).toBe('db');
    service.deleteWorkspace(workspace.id);
    await service.flush();
    expect(repository.snapshots.has(workspace.id)).toBe(false);
  });

  it('keeps the legacy copy when migration cannot reach SQLite', async () => {
    const repository = new FakeTodoRepository();
    repository.failSave = true;
    const legacy: TodoWorkspaceSnapshot = {
      version: 1,
      workspaceId: workspace.id,
      projects: [
        {
          id: 'p',
          workspaceId: workspace.id,
          name: 'App',
          path: 'D:/app',
          color: '#fff',
          createdAt: 1,
        },
      ],
      tasks: [],
    };
    const contents = JSON.stringify({ [workspace.id]: legacy });
    localStorage.setItem('termexo.todos.v1', contents);
    const service = new TodoService(repository);

    await service.initialize([workspace]);
    expect(service.storageError()).toContain('database unavailable');
    expect(localStorage.getItem('termexo.todos.v1')).toBe(contents);
  });
});
