import { createId } from '../models/identifiers';
import type { TodoProject, TodoTask, TodoWorkspaceSnapshot } from '../models/todo.models';

const FORMAT = 'termexo-tasks';
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const STAGES = new Set(['todo', 'executing', 'completed', 'verified']);
const PRIORITIES = new Set(['low', 'medium', 'high']);
const AGENTS = new Set(['claude', 'codex', 'opencode', 'grok', 'antigravity']);
const EXECUTION_STATES = new Set([
  'idle',
  'starting',
  'running',
  'waiting',
  'failed',
  'completed',
  'stopped',
]);
const DELIVERY_STATES = new Set(['idle', 'pending', 'sending', 'delivered', 'failed']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A portable, reviewable backup of one workspace's projects and tasks. */
export function serializeTodoExport(snapshot: TodoWorkspaceSnapshot): string {
  return JSON.stringify(
    { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), snapshot },
    null,
    2,
  );
}

export function parseTodoImport(contents: string): TodoWorkspaceSnapshot {
  if (new TextEncoder().encode(contents).length > MAX_IMPORT_BYTES) {
    throw new Error('Task import exceeds the 16 MB limit');
  }
  let document: unknown;
  try {
    document = JSON.parse(contents);
  } catch {
    throw new Error('Task import is not valid JSON');
  }
  if (!record(document) || document['format'] !== FORMAT || document['version'] !== 1) {
    throw new Error('Unsupported task export format');
  }
  const snapshot = document['snapshot'];
  if (
    !record(snapshot) ||
    snapshot['version'] !== 1 ||
    !nonempty(snapshot['workspaceId']) ||
    !Array.isArray(snapshot['projects']) ||
    snapshot['projects'].length === 0 ||
    !Array.isArray(snapshot['tasks'])
  ) {
    throw new Error('Task export has no valid workspace snapshot');
  }
  const projects = snapshot['projects'];
  const tasks = snapshot['tasks'];
  const projectIds = new Set<string>();
  for (const project of projects) {
    if (
      !record(project) ||
      !nonempty(project['id']) ||
      !nonempty(project['name']) ||
      !nonempty(project['path']) ||
      typeof project['color'] !== 'string' ||
      !Number.isFinite(project['createdAt']) ||
      projectIds.has(project['id'])
    ) {
      throw new Error('Task export contains an invalid or duplicate project');
    }
    projectIds.add(project['id']);
  }
  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (
      !record(task) ||
      !nonempty(task['id']) ||
      taskIds.has(task['id']) ||
      !projectIds.has(String(task['projectId'])) ||
      !nonempty(task['title']) ||
      typeof task['description'] !== 'string' ||
      typeof task['acceptanceCriteria'] !== 'string' ||
      !STAGES.has(String(task['stage'])) ||
      !PRIORITIES.has(String(task['priority'])) ||
      !AGENTS.has(String(task['agentType'])) ||
      typeof task['profileId'] !== 'string' ||
      typeof task['modelName'] !== 'string' ||
      !Number.isFinite(task['sortOrder']) ||
      !Number.isFinite(task['attempts']) ||
      typeof task['recurring'] !== 'boolean' ||
      !Number.isFinite(task['runCount']) ||
      !Number.isFinite(task['createdAt']) ||
      !Number.isFinite(task['updatedAt']) ||
      !EXECUTION_STATES.has(String(task['executionState'])) ||
      !DELIVERY_STATES.has(String(task['promptDeliveryState'])) ||
      !Array.isArray(task['validations']) ||
      task['validations'].some(
        (item: unknown) =>
          !record(item) ||
          !nonempty(item['id']) ||
          !['passed', 'failed'].includes(String(item['outcome'])) ||
          typeof item['note'] !== 'string' ||
          !Number.isFinite(item['createdAt']),
      )
    ) {
      throw new Error('Task export contains an invalid or duplicate task');
    }
    taskIds.add(task['id']);
  }
  return snapshot as unknown as TodoWorkspaceSnapshot;
}

/** Imported items get new IDs and live in the selected workspace without stale terminal links. */
export function mergeTodoImport(
  current: TodoWorkspaceSnapshot,
  imported: TodoWorkspaceSnapshot,
): TodoWorkspaceSnapshot {
  const projectIds = new Map<string, string>();
  const nextOrder = new Map<string, number>();
  for (const task of current.tasks) {
    nextOrder.set(task.stage, Math.max(nextOrder.get(task.stage) ?? 0, task.sortOrder + 1));
  }
  const projects: TodoProject[] = imported.projects.map((project) => {
    const id = `project-${createId()}`;
    projectIds.set(project.id, id);
    return { ...project, id, workspaceId: current.workspaceId };
  });
  const tasks: TodoTask[] = imported.tasks.map((task) => {
    const {
      terminalId: _terminalId,
      preferredTerminalId: _preferredTerminalId,
      nativeSessionId: _nativeSessionId,
      nativeSessionAgentType: _nativeSessionAgentType,
      accountProfileId: _accountProfileId,
      lastTerminalStatus: _lastTerminalStatus,
      ...portable
    } = task;
    const stage = task.stage === 'executing' ? 'todo' : task.stage;
    const sortOrder = nextOrder.get(stage) ?? 0;
    nextOrder.set(stage, sortOrder + 1);
    return {
      ...portable,
      id: `task-${createId()}`,
      workspaceId: current.workspaceId,
      projectId: projectIds.get(task.projectId)!,
      stage,
      sortOrder,
      executionState: task.stage === 'executing' ? 'idle' : task.executionState,
      promptDeliveryState: task.stage === 'executing' ? 'idle' : task.promptDeliveryState,
      ...(task.stage === 'executing'
        ? {
            startedAt: undefined,
            promptDeliveredAt: undefined,
            outputTail: undefined,
            lastError: undefined,
          }
        : {}),
      validations: task.validations.map((item) => ({ ...item, id: `validation-${createId()}` })),
    };
  });
  return {
    ...current,
    projects: [...current.projects, ...projects],
    tasks: [...current.tasks, ...tasks],
  };
}
