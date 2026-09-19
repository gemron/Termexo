import {
  compatibleNativeSessionId,
  type AgentEvent,
  type AgentSession,
  type NativeAgentType,
} from './agent.models';
import type { TerminalSession, TerminalStatus, Workspace } from './workspace.models';

export type TodoStage = 'todo' | 'executing' | 'completed' | 'verified';
export type TodoPriority = 'low' | 'medium' | 'high';
/** `stopped` is a run the user halted: it keeps its terminal and session so it can go on. */
export type TodoExecutionState =
  'idle' | 'starting' | 'running' | 'waiting' | 'failed' | 'completed' | 'stopped';
export type TodoPromptDeliveryState = 'idle' | 'pending' | 'sending' | 'delivered' | 'failed';

export interface TodoProject {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  color: string;
  createdAt: number;
}

export interface TodoProjectDraft {
  name: string;
  path: string;
}

export interface TodoValidationRecord {
  id: string;
  outcome: 'passed' | 'failed';
  note: string;
  createdAt: number;
}

export interface TodoTask {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: TodoPriority;
  stage: TodoStage;
  sortOrder: number;
  /** Overrides the project directory when this task must run somewhere else. */
  workingDirectory?: string;
  /**
   * OpenCode and Grok Build resolve their own model and credentials, so tasks targeting them
   * carry an empty `profileId`.
   */
  agentType: NativeAgentType;
  profileId: string;
  modelName: string;
  /** Existing Agent terminal to reuse for the first execution; absent means create one. */
  preferredTerminalId?: string;
  terminalId?: string;
  nativeSessionId?: string;
  /** Agent that owns nativeSessionId; prevents a Claude ID from being passed to Codex or vice versa. */
  nativeSessionAgentType?: TodoTask['agentType'];
  /** Account home that owns the native session, needed when resuming from a managed account. */
  accountProfileId?: string;
  executionState: TodoExecutionState;
  /** Tracks whether the task instructions actually reached the bound terminal's stdin. */
  promptDeliveryState: TodoPromptDeliveryState;
  promptDeliveredAt?: number;
  lastTerminalStatus?: TerminalStatus;
  outputTail?: string;
  lastError?: string;
  attempts: number;
  /** A routine task, such as a build: once finished it can return to the to-do column and rerun. */
  recurring: boolean;
  /** Finished runs already archived by {@link canRestartTodoTask}; only routine tasks exceed zero. */
  runCount: number;
  /** When the previous run of a routine task finished, kept after the run itself is cleared. */
  lastRunAt?: number;
  validations: TodoValidationRecord[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  verifiedAt?: number;
}

export interface TodoWorkspaceSnapshot {
  version: 1;
  workspaceId: string;
  projects: TodoProject[];
  tasks: TodoTask[];
}

export interface TodoTaskDraft {
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: TodoPriority;
  workingDirectory: string;
  agentType: TodoTask['agentType'];
  profileId: string;
  modelName: string;
  preferredTerminalId?: string;
  recurring?: boolean;
}

export interface TodoExecutionBinding {
  terminalId: string;
  nativeSessionId?: string;
  accountProfileId?: string;
}

export interface TodoContinuationRequest {
  taskId: string;
  feedback: string;
  description: string;
  acceptanceCriteria: string;
}

/**
 * The board's columns, in board order.
 *
 * Text fields hold translation keys only: the wording lives in the board's lazy translation bundle,
 * which this file must not import or it would be pulled into the initial bundle.
 */
export const TODO_COLUMNS: ReadonlyArray<{
  stage: TodoStage;
  titleKey: string;
  descriptionKey: string;
}> = [
  {
    stage: 'todo',
    titleKey: 'taskBoard.column.todo.title',
    descriptionKey: 'taskBoard.column.todo.description',
  },
  {
    stage: 'executing',
    titleKey: 'taskBoard.column.executing.title',
    descriptionKey: 'taskBoard.column.executing.description',
  },
  {
    stage: 'completed',
    titleKey: 'taskBoard.column.completed.title',
    descriptionKey: 'taskBoard.column.completed.description',
  },
  {
    stage: 'verified',
    titleKey: 'taskBoard.column.verified.title',
    descriptionKey: 'taskBoard.column.verified.description',
  },
];

/** Ordered highest first, the order the board offers them in; labels are translation keys. */
export const TODO_PRIORITIES: ReadonlyArray<{ value: TodoPriority; labelKey: string }> = [
  { value: 'high', labelKey: 'taskBoard.priority.high' },
  { value: 'medium', labelKey: 'taskBoard.priority.medium' },
  { value: 'low', labelKey: 'taskBoard.priority.low' },
];

/** A routine task template whose text fields are translation keys, resolved when it is applied. */
export interface TodoRoutinePreset {
  id: string;
  titleKey: string;
  descriptionKey: string;
  acceptanceCriteriaKey: string;
}

/**
 * Ready-made routine tasks for the chores every project repeats.
 *
 * They only fill the task form, so each project still points them at its own directory and model.
 */
export const TODO_ROUTINE_PRESETS: readonly TodoRoutinePreset[] = [
  {
    id: 'build',
    titleKey: 'taskBoard.preset.build.title',
    descriptionKey: 'taskBoard.preset.build.description',
    acceptanceCriteriaKey: 'taskBoard.preset.build.acceptanceCriteria',
  },
  {
    id: 'package',
    titleKey: 'taskBoard.preset.package.title',
    descriptionKey: 'taskBoard.preset.package.description',
    acceptanceCriteriaKey: 'taskBoard.preset.package.acceptanceCriteria',
  },
  {
    id: 'release',
    titleKey: 'taskBoard.preset.release.title',
    descriptionKey: 'taskBoard.preset.release.description',
    acceptanceCriteriaKey: 'taskBoard.preset.release.acceptanceCriteria',
  },
];

export const TODO_PROJECT_COLORS = [
  '#58c7a0',
  '#68a9e8',
  '#a78bfa',
  '#e4a35a',
  '#ef7890',
  '#52c7d9',
] as const;

export function defaultTodoProject(workspace: Workspace, now = Date.now()): TodoProject {
  return {
    id: `project-${workspace.id}`,
    workspaceId: workspace.id,
    name: workspace.name,
    path: workspace.projectPath,
    color: workspace.themeColor ?? TODO_PROJECT_COLORS[0],
    createdAt: now,
  };
}

/**
 * Whether a finished run can be handed back to the to-do column for another go.
 *
 * Only routine tasks repeat: an ordinary task is done once it is verified, while build, package and
 * release chores are expected to run again on the next change.
 */
export function canRestartTodoTask(task: TodoTask): boolean {
  return task.recurring && (task.stage === 'completed' || task.stage === 'verified');
}

/**
 * Whether a halted run can pick up where it left off.
 *
 * Stopping keeps the terminal binding, the session and the captured output, so continuing is a
 * matter of talking to the same agent again rather than starting the task over.
 */
export function canResumeTodoTask(task: TodoTask): boolean {
  return task.stage === 'executing' && task.executionState === 'stopped';
}

/** Whether new instructions can be handed to the agent that is working on this task right now. */
export function canAmendTodoTask(task: TodoTask): boolean {
  return (
    task.stage === 'executing' && task.executionState !== 'stopped' && Boolean(task.terminalId)
  );
}

/** Where the agent terminal is started: the task override wins over the project directory. */
export function todoWorkingDirectory(task: TodoTask, project: TodoProject | null): string {
  return task.workingDirectory?.trim() || project?.path.trim() || '';
}

/**
 * Returns a native session only when it belongs to the task's current Agent.
 *
 * Older persisted tasks predate nativeSessionAgentType, so scanned sessions and hook events are
 * accepted as migration evidence. An unknown task ID starts a fresh session: the task prompt still
 * carries its requirements, while guessing could pass a Claude ID to Codex (or vice versa).
 */
export function compatibleTodoSessionId(
  task: TodoTask,
  sessions: readonly Pick<AgentSession, 'agentType' | 'nativeSessionId'>[],
  events: readonly Pick<AgentEvent, 'agentType' | 'nativeSessionId'>[],
): string | undefined {
  if (!task.nativeSessionAgentType) {
    const sessionId = task.nativeSessionId?.trim();
    if (!sessionId) return undefined;
    const knownAgentTypes = new Set(
      [...sessions, ...events]
        .filter((item) => item.nativeSessionId === sessionId)
        .map((item) => item.agentType),
    );
    return knownAgentTypes.has(task.agentType) ? sessionId : undefined;
  }

  return compatibleNativeSessionId(
    task.agentType,
    task.nativeSessionId,
    task.nativeSessionAgentType,
    sessions,
    events,
  );
}

/**
 * Terminals a task can be bound to at all: the board launches through the Claude and Codex
 * adapters only, so no other agent may reach {@link isReusableTodoTerminal}.
 */
export function isTodoAgentTerminal(
  terminal: TerminalSession,
): terminal is TerminalSession & { agentType: TodoTask['agentType'] } {
  return terminal.agentType !== 'shell';
}

/** Agent terminals that are alive and at a prompt where a new task can be submitted. */
export function isReusableTodoTerminal(
  terminal: TerminalSession,
): terminal is TerminalSession & { agentType: TodoTask['agentType'] } {
  return (
    isTodoAgentTerminal(terminal) &&
    ['RUNNING', 'WAITING_INPUT', 'IDLE', 'COMPLETED'].includes(terminal.status)
  );
}

/**
 * The execution state a task reports for its terminal's status.
 *
 * A rate-limited agent is waiting rather than failed: its process is alive and resumes once the
 * limit lifts or the user switches model. An idle one is at its prompt without having finished —
 * before the task reached it that is just the CLI starting up, but once the prompt was delivered
 * the turn was interrupted and the run needs the user to go on.
 */
export function terminalStatusToExecutionState(
  status: TerminalStatus,
  promptDelivery: TodoPromptDeliveryState,
): TodoExecutionState {
  switch (status) {
    case 'STARTING':
      return 'starting';
    case 'RUNNING':
    case 'THINKING':
      return 'running';
    case 'WAITING_INPUT':
    case 'WAITING_APPROVAL':
    case 'RATE_LIMITED':
      return 'waiting';
    case 'COMPLETED':
      return 'completed';
    case 'FAILED':
    case 'STOPPED':
    case 'DISCONNECTED':
      return 'failed';
    case 'IDLE':
      return promptDelivery === 'delivered' ? 'waiting' : 'idle';
  }
}

/**
 * Secondary actions rendered under a card's "more" menu. Every entry's label and tooltip come
 * from i18n keys so the view layer can render them with the active locale.
 */
export type TaskMoreActionKey =
  | 'backlog'
  | 'amend'
  | 'submit'
  | 'stop'
  | 'reject'
  | 'verify-close'
  | 'delete';

export interface TaskMoreAction {
  readonly key: TaskMoreActionKey;
  readonly labelKey: string;
  readonly icon: string;
  readonly titleKey: string;
  /** Parameters for the title interpolation, e.g. the terminal name for verify-close. */
  readonly titleParams?: Readonly<Record<string, string>>;
}
