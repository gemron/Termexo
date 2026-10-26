import type { AgentEvent } from './agent.models';
import type { TodoTask, TodoWorkspaceSnapshot } from './todo.models';
import type { TerminalSession, TerminalStatus, Workspace } from './workspace.models';

export type WechatEventKind = 'completed' | 'error' | 'approval' | 'input';
export interface WechatSettings {
  enabled: boolean;
  target: string;
  workspaceIds: string[];
  allWorkspaces: boolean;
  completed: boolean;
  errors: boolean;
  approval: boolean;
  input: boolean;
}
export interface WechatNotification {
  workspaceId: string;
  eventKey: string;
  kind: WechatEventKind;
  terminalId?: string;
  taskTitle?: string;
}
export interface WechatDelivery {
  id: string;
  target: string;
  kind: string;
  workspaceId: string;
  createdAt: number;
  status: 'pending' | 'submitted' | 'failed' | 'uncertain';
  detail: string;
}
export const DEFAULT_WECHAT_SETTINGS: WechatSettings = {
  enabled: false,
  target: '文件传输助手',
  workspaceIds: [],
  allWorkspaces: true,
  completed: true,
  errors: true,
  approval: true,
  input: false,
};
const EVENT_KINDS: Readonly<Record<string, WechatEventKind>> = {
  'task.completed': 'completed',
  'agent.failed': 'error',
  'tool.failed': 'error',
  'agent.rate_limited': 'error',
  'approval.required': 'approval',
  'user.input.required': 'input',
  'agent.timeout': 'input',
};
const STATUS_KINDS: Partial<Record<TerminalStatus, WechatEventKind>> = {
  COMPLETED: 'completed',
  FAILED: 'error',
  RATE_LIMITED: 'error',
  WAITING_APPROVAL: 'approval',
  WAITING_INPUT: 'input',
};
const eligible = (terminal: TerminalSession) =>
  terminal.agentType !== 'shell' && !terminal.commonActionId && !terminal.accountLogin;

/** Observes new occurrences, never restored state. Hook identities preserve later errors/approvals even in the same status. */
export class WechatEventTracker {
  private initialized = false;
  private readonly seen = new Set<string>();
  private readonly statuses = new Map<string, string>();
  private readonly tasks = new Map<string, string>();
  private readonly awaitingStatus = new Set<string>();
  private readonly awaitingHook = new Set<string>();
  private sequence = 0;
  constructor(private readonly startedAt = Date.now()) {}

  collect(
    workspaces: readonly Workspace[],
    snapshots: Record<string, TodoWorkspaceSnapshot>,
    events: readonly AgentEvent[],
  ): WechatNotification[] {
    const result: WechatNotification[] = [];
    const tasks = Object.values(snapshots).flatMap((snapshot) => snapshot.tasks);
    const byTerminal = new Map<string, TodoTask>();
    for (const task of [...tasks].sort((a, b) => a.updatedAt - b.updatedAt))
      if (task.terminalId) byTerminal.set(task.terminalId, task);
    const terminals = new Map(
      workspaces.flatMap((workspace) =>
        workspace.terminals
          .filter(eligible)
          .map((terminal) => [terminal.id, { workspace, terminal }] as const),
      ),
    );
    if (!this.initialized) {
      for (const event of events) this.seen.add(event.eventKey);
      for (const { terminal } of terminals.values())
        this.statuses.set(terminal.id, `${terminal.runtimeRevision ?? 0}:${terminal.status}`);
      for (const task of tasks) this.tasks.set(task.id, this.taskState(task));
      this.initialized = true;
      return [];
    }
    const covered = new Set<string>();
    const completionKey = (task: TodoTask) =>
      `task:${task.id}:${task.attempts}:${task.runCount}:completed`;
    for (const event of events) {
      if (this.seen.has(event.eventKey)) continue;
      this.seen.add(event.eventKey);
      if (event.createdAt < this.startedAt) continue;
      const kind = EVENT_KINDS[event.eventType];
      const located = terminals.get(event.terminalId);
      if (!kind || !located || event.agentType !== located.terminal.agentType) continue;
      const task = byTerminal.get(event.terminalId);
      covered.add(`${event.terminalId}:${kind}`);
      const occurrence = `${event.terminalId}:${kind}`;
      if (this.awaitingHook.delete(occurrence)) continue;
      if (STATUS_KINDS[located.terminal.status] !== kind) this.awaitingStatus.add(occurrence);
      const requestId = event.detail?.['request_id'] ?? event.detail?.['tool_use_id'];
      const key =
        kind === 'completed' && task?.completedAt
          ? completionKey(task)
          : kind === 'approval' && typeof requestId === 'string'
            ? `approval:${event.terminalId}:${requestId}`
            : `hook:${event.eventKey}`;
      result.push({
        workspaceId: located.workspace.id,
        eventKey: key,
        kind,
        terminalId: event.terminalId,
        taskTitle: task?.title ?? located.terminal.name,
      });
    }
    for (const { workspace, terminal } of terminals.values()) {
      const state = `${terminal.runtimeRevision ?? 0}:${terminal.status}`;
      const previous = this.statuses.get(terminal.id);
      this.statuses.set(terminal.id, state);
      const kind = STATUS_KINDS[terminal.status];
      const occurrence = `${terminal.id}:${kind}`;
      const hookAlreadyReported = kind && this.awaitingStatus.delete(occurrence);
      if (!kind) {
        for (const item of this.awaitingHook)
          if (item.startsWith(`${terminal.id}:`)) this.awaitingHook.delete(item);
      }
      if (
        !previous ||
        previous === state ||
        !kind ||
        hookAlreadyReported ||
        covered.has(occurrence)
      )
        continue;
      this.awaitingHook.add(occurrence);
      const task = byTerminal.get(terminal.id);
      result.push({
        workspaceId: workspace.id,
        terminalId: terminal.id,
        taskTitle: task?.title ?? terminal.name,
        kind,
        eventKey:
          kind === 'completed' && task?.completedAt
            ? completionKey(task)
            : `state:${this.startedAt}:${terminal.id}:${state}:${++this.sequence}`,
      });
      covered.add(`${terminal.id}:${kind}`);
    }
    for (const task of tasks) {
      const state = this.taskState(task);
      const previous = this.tasks.get(task.id);
      this.tasks.set(task.id, state);
      if (!previous || previous === state || task.updatedAt < this.startedAt) continue;
      const kind =
        task.executionState === 'failed'
          ? 'error'
          : task.stage === 'completed'
            ? 'completed'
            : null;
      if (!kind || (task.terminalId && covered.has(`${task.terminalId}:${kind}`))) continue;
      if (kind === 'error' && task.terminalId && terminals.has(task.terminalId)) continue;
      // A live terminal already owns error/completion reporting. This branch catches launch failures and manual completions.
      result.push({
        workspaceId: task.workspaceId,
        taskTitle: task.title,
        kind,
        eventKey:
          kind === 'completed'
            ? completionKey(task)
            : `task:${task.id}:${task.attempts}:${task.updatedAt}:error`,
      });
    }
    if (this.seen.size > 5000) {
      const tail = [...this.seen].slice(-2500);
      this.seen.clear();
      tail.forEach((key) => this.seen.add(key));
    }
    return [...new Map(result.map((item) => [item.eventKey, item])).values()];
  }
  private taskState(task: TodoTask): string {
    return `${task.attempts}:${task.runCount}:${task.stage}:${task.executionState}:${task.lastError ?? ''}`;
  }
}
