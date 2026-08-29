import {
  compatibleNativeSessionId,
  type AgentEvent,
  type AgentProtocol,
  type AgentSession,
} from './agent.models';
import type { TerminalSession, TerminalStatus, Workspace } from './workspace.models';

export type TodoStage = 'todo' | 'executing' | 'completed' | 'verified';
export type TodoPriority = 'low' | 'medium' | 'high';
export type TodoExecutionState =
  'idle' | 'starting' | 'running' | 'waiting' | 'failed' | 'completed';
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
  agentType: AgentProtocol;
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
  /** 常用任务：完成后可以放回待办反复执行，例如编译、打包、发布。 */
  recurring: boolean;
  /** Finished runs already archived by {@link canRestartTodoTask}; only 常用任务 go past zero. */
  runCount: number;
  /** When the previous run of a 常用任务 finished, kept after the run itself is cleared. */
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

export const TODO_COLUMNS: ReadonlyArray<{
  stage: TodoStage;
  title: string;
  description: string;
}> = [
  { stage: 'todo', title: '待办', description: '整理需求并分配模型' },
  { stage: 'executing', title: '执行中', description: 'Agent 正在处理任务' },
  { stage: 'completed', title: '已完成', description: '等待人工验收' },
  { stage: 'verified', title: '已验证', description: '验收通过并归档' },
];

/** Ordered highest first, which is the order the board offers them in. */
export const TODO_PRIORITIES: ReadonlyArray<{ value: TodoPriority; label: string }> = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
];

export interface TodoRoutinePreset {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
}

/**
 * Ready-made 常用任务 for the chores every project repeats.
 *
 * They only fill the task form, so each project still points them at its own directory and model.
 */
export const TODO_ROUTINE_PRESETS: readonly TodoRoutinePreset[] = [
  {
    id: 'build',
    title: '编译',
    description: '在项目工作目录执行编译命令，确认当前代码可以正常构建。',
    acceptanceCriteria: '编译命令执行成功，没有编译错误或类型错误。',
  },
  {
    id: 'package',
    title: '打包',
    description: '执行打包流程，产出可分发的构建产物。',
    acceptanceCriteria: '打包成功，产物齐全且版本号与项目配置一致。',
  },
  {
    id: 'release',
    title: '发布',
    description: '核对版本号与变更说明，执行发布流程并确认发布结果。',
    acceptanceCriteria: '发布流程执行成功，并说明发布的版本与内容。',
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
 * Whether a finished run can be handed back to 待办 for another go.
 *
 * Only 常用任务 repeat: an ordinary task is done once it is verified, while 编译 / 打包 / 发布 are
 * expected to run again on the next change.
 */
export function canRestartTodoTask(task: TodoTask): boolean {
  return task.recurring && (task.stage === 'completed' || task.stage === 'verified');
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
  return terminal.agentType === 'claude' || terminal.agentType === 'codex';
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

export function terminalStatusToExecutionState(status: TerminalStatus): TodoExecutionState {
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
      return 'idle';
  }
}
