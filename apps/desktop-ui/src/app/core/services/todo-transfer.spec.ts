import { describe, expect, it } from 'vitest';

import type { TodoWorkspaceSnapshot } from '../models/todo.models';
import { mergeTodoImport, parseTodoImport, serializeTodoExport } from './todo-transfer';

const snapshot: TodoWorkspaceSnapshot = {
  version: 1,
  workspaceId: 'source',
  projects: [
    {
      id: 'project-1',
      workspaceId: 'source',
      name: 'App',
      path: 'D:/app',
      color: '#00aaaa',
      createdAt: 1,
    },
  ],
  tasks: [
    {
      id: 'task-1',
      workspaceId: 'source',
      projectId: 'project-1',
      title: 'Build',
      description: 'Run the build',
      acceptanceCriteria: 'Passes',
      priority: 'high',
      stage: 'executing',
      sortOrder: 0,
      agentType: 'codex',
      profileId: 'codex-default',
      modelName: 'gpt-5',
      terminalId: 'old-terminal',
      nativeSessionId: 'old-session',
      executionState: 'running',
      promptDeliveryState: 'delivered',
      attempts: 1,
      recurring: false,
      runCount: 0,
      validations: [],
      createdAt: 1,
      updatedAt: 2,
    },
  ],
};

describe('task board transfer', () => {
  it('round-trips a workspace export and merges it without ID collisions or live bindings', () => {
    const imported = parseTodoImport(serializeTodoExport(snapshot));
    expect(imported).toEqual(snapshot);
    const target: TodoWorkspaceSnapshot = { ...snapshot, workspaceId: 'target' };
    const merged = mergeTodoImport(target, imported);

    expect(merged.projects).toHaveLength(2);
    expect(merged.tasks).toHaveLength(2);
    expect(merged.projects[1].id).not.toBe('project-1');
    expect(merged.tasks[1]).toMatchObject({
      workspaceId: 'target',
      projectId: merged.projects[1].id,
      stage: 'todo',
      executionState: 'idle',
      promptDeliveryState: 'idle',
    });
    expect(merged.tasks[1].id).not.toBe('task-1');
    expect(merged.tasks[1].terminalId).toBeUndefined();
    expect(merged.tasks[1].nativeSessionId).toBeUndefined();
  });

  it('rejects malformed documents and broken task project references', () => {
    expect(() => parseTodoImport('{')).toThrow('valid JSON');
    const invalid = JSON.parse(serializeTodoExport(snapshot));
    invalid.snapshot.tasks[0].projectId = 'missing';
    expect(() => parseTodoImport(JSON.stringify(invalid))).toThrow('invalid or duplicate task');
  });
});
