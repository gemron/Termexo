import { Injectable, signal } from '@angular/core';

import type { AgentEvent } from '../models/agent.models';
import { EVENT_STATUS } from '../models/agent.models';
import { createId } from '../models/identifiers';
import { stripTerminalControl } from '../models/terminal-output';
import {
  canRestartTodoTask,
  defaultTodoProject,
  terminalStatusToExecutionState,
  TODO_PROJECT_COLORS,
  TodoContinuationRequest,
  TodoExecutionBinding,
  TodoProject,
  TodoProjectDraft,
  TodoTask,
  TodoTaskDraft,
  TodoWorkspaceSnapshot,
} from '../models/todo.models';
import type { TerminalStatus, Workspace } from '../models/workspace.models';
import { mergeTodoImport, parseTodoImport, serializeTodoExport } from './todo-transfer';
import { TodoRepository } from './todo.repository';

const STORAGE_KEY = 'termexo.todos.v1';
const OUTPUT_TAIL_LIMIT = 1_200;
/*
 * A task's `lastError` holds a key from `core/i18n/todo.i18n.ts` rather than a sentence, so the
 * board shows it in the language active when it renders. That bundle is loaded lazily by `App`,
 * which is why the keys are spelled out here instead of imported.
 */
const TERMINAL_ENDED_ERROR = 'taskFlow.error.terminalEnded';
/** A failure the agent reported itself, with its terminal still open for another try. */
const AGENT_FAILED_ERROR = 'taskFlow.error.agentFailed';
const TERMINAL_MISSING_ERROR = 'taskFlow.error.terminalMissing';
const PROMPT_INTERRUPTED_ERROR = 'taskFlow.error.promptInterrupted';
/** Terminal states that end a run for good, which a stopped task still has to hear about. */
const TERMINAL_GONE_STATUSES: readonly TerminalStatus[] = ['FAILED', 'STOPPED', 'DISCONNECTED'];

function createTodoId(prefix: string): string {
  return `${prefix}-${createId()}`;
}

/** A project is only usable once it names both a label and a directory to run agents in. */
function normalizeProjectDraft(draft: TodoProjectDraft): TodoProjectDraft | null {
  const name = draft.name.trim();
  const path = draft.path.trim();
  return name && path ? { name, path } : null;
}

@Injectable({ providedIn: 'root' })
export class TodoService {
  constructor(private readonly repository: TodoRepository = new TodoRepository()) {}

  private readonly snapshotItems = signal<Record<string, TodoWorkspaceSnapshot>>({});
  private readonly storageErrorState = signal<string | null>(null);
  private readonly queuedSnapshots = new Map<string, string>();
  private readonly pendingWorkspaceIds = new Map<string, number>();
  private mutationQueue: Promise<void> = Promise.resolve();

  readonly snapshots = this.snapshotItems.asReadonly();
  readonly storageError = this.storageErrorState.asReadonly();

  async initialize(workspaces: readonly Workspace[]): Promise<void> {
    const backend = this.repository.enabled();
    const stored = this.readStoredSnapshots();
    const workspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    const databaseSnapshots = backend ? await this.repository.list() : [];
    const next: Record<string, TodoWorkspaceSnapshot> = {};
    for (const snapshot of databaseSnapshots) {
      if (snapshot?.workspaceId && snapshot.version === 1) {
        next[snapshot.workspaceId] = snapshot;
        this.queuedSnapshots.set(snapshot.workspaceId, JSON.stringify(snapshot));
      }
    }
    // Import each legacy workspace only when the database does not already own it.
    for (const [id, snapshot] of Object.entries(stored)) {
      if (workspaceIds.has(id) && !next[id] && snapshot?.workspaceId === id) next[id] = snapshot;
    }
    for (const workspace of workspaces) {
      next[workspace.id] = this.normalizeSnapshot(workspace, next[workspace.id]);
    }
    this.snapshotItems.set(next);
    await this.persist();
    if (backend) {
      // The legacy key is removed only after all migrated snapshots reached SQLite.
      if (!this.storageErrorState()) {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          // SQLite already has the data; the stale browser copy is ignored on later starts.
        }
      }
      await this.repository.watch(({ workspaceId, snapshot }) => {
        if (this.pendingWorkspaceIds.has(workspaceId)) return;
        if (snapshot) {
          this.queuedSnapshots.set(workspaceId, JSON.stringify(snapshot));
          this.snapshotItems.update((items) => ({ ...items, [workspaceId]: snapshot }));
        } else {
          this.queuedSnapshots.delete(workspaceId);
          this.snapshotItems.update((items) => {
            const next = { ...items };
            delete next[workspaceId];
            return next;
          });
        }
      });
    }
  }

  exportWorkspace(workspaceId: string): string {
    const snapshot = this.snapshot(workspaceId);
    if (!snapshot) throw new Error('No task board for this workspace');
    return serializeTodoExport(snapshot);
  }

  async importWorkspace(workspace: Workspace, contents: string): Promise<number> {
    const imported = parseTodoImport(contents);
    this.ensureWorkspace(workspace);
    await this.mutationQueue;
    const merged = mergeTodoImport(this.snapshot(workspace.id)!, imported);
    if (this.repository.enabled()) await this.repository.save(merged);
    this.queuedSnapshots.set(workspace.id, JSON.stringify(merged));
    this.snapshotItems.update((items) => ({ ...items, [workspace.id]: merged }));
    if (!this.repository.enabled()) this.persist();
    this.storageErrorState.set(null);
    return imported.tasks.length;
  }

  async flush(): Promise<void> {
    await this.mutationQueue;
    const error = this.storageErrorState();
    if (error) throw new Error(error);
  }

  /** Reconnects persisted executing tasks to the terminals restored with their workspace. */
  reconcileTerminals(workspaces: readonly Workspace[]): void {
    const terminals = new Map(
      workspaces.flatMap((workspace) =>
        workspace.terminals.map((terminal) => [terminal.id, terminal]),
      ),
    );
    const now = Date.now();
    let changed = false;
    const snapshots = Object.fromEntries(
      Object.entries(this.snapshotItems()).map(([workspaceId, snapshot]) => {
        const tasks = snapshot.tasks.map((task) => {
          if (task.stage !== 'executing') return task;
          const terminal = task.terminalId ? terminals.get(task.terminalId) : undefined;
          changed = true;
          const reconciled = this.taskWithTerminalStatus(
            task,
            terminal?.status ?? 'DISCONNECTED',
            now,
            terminal ? undefined : TERMINAL_MISSING_ERROR,
          );
          // A terminal that already failed reports the more specific reason, so it keeps its own.
          return reconciled.executionState === 'failed'
            ? reconciled
            : this.taskWithInterruptedPrompt(reconciled, now);
        });
        return [workspaceId, { ...snapshot, tasks }];
      }),
    );
    if (!changed) return;
    this.snapshotItems.set(snapshots);
    this.persist();
  }

  ensureWorkspace(workspace: Workspace): TodoWorkspaceSnapshot {
    const existing = this.snapshotItems()[workspace.id];
    if (existing) {
      return existing;
    }
    const snapshot = this.normalizeSnapshot(workspace, undefined);
    this.snapshotItems.update((items) => ({ ...items, [workspace.id]: snapshot }));
    this.persist();
    return snapshot;
  }

  snapshot(workspaceId: string): TodoWorkspaceSnapshot | null {
    return this.snapshotItems()[workspaceId] ?? null;
  }

  projectsFor(workspaceId: string): TodoProject[] {
    return this.snapshot(workspaceId)?.projects ?? [];
  }

  tasksFor(workspaceId: string): TodoTask[] {
    return this.snapshot(workspaceId)?.tasks ?? [];
  }

  task(taskId: string): TodoTask | null {
    return this.findTask(taskId)?.task ?? null;
  }

  project(projectId: string): TodoProject | null {
    return this.findProject(projectId)?.project ?? null;
  }

  createProject(workspaceId: string, draft: TodoProjectDraft): TodoProject | null {
    const snapshot = this.snapshot(workspaceId);
    const normalized = normalizeProjectDraft(draft);
    if (!snapshot || !normalized) {
      return null;
    }
    const project: TodoProject = {
      id: createTodoId('project'),
      workspaceId,
      ...normalized,
      color: TODO_PROJECT_COLORS[snapshot.projects.length % TODO_PROJECT_COLORS.length],
      createdAt: Date.now(),
    };
    this.replaceSnapshot({ ...snapshot, projects: [...snapshot.projects, project] });
    return project;
  }

  updateProject(projectId: string, draft: TodoProjectDraft): TodoProject | null {
    const located = this.findProject(projectId);
    const normalized = normalizeProjectDraft(draft);
    if (!located || !normalized) {
      return null;
    }
    const project: TodoProject = { ...located.project, ...normalized };
    this.replaceSnapshot({
      ...located.snapshot,
      projects: located.snapshot.projects.map((item) => (item.id === projectId ? project : item)),
    });
    return project;
  }

  /**
   * Removes an empty project.
   *
   * Deleting a project that still holds tasks would take real work with it, and a board with no
   * project left cannot describe where a task runs, so both cases are refused rather than
   * resolved silently. {@link canDeleteProject} lets the UI explain that before it is attempted.
   */
  deleteProject(projectId: string): boolean {
    const located = this.findProject(projectId);
    if (!located || !this.canDeleteProject(projectId)) return false;
    this.replaceSnapshot({
      ...located.snapshot,
      projects: located.snapshot.projects.filter((item) => item.id !== projectId),
    });
    return true;
  }

  canDeleteProject(projectId: string): boolean {
    const located = this.findProject(projectId);
    if (!located) return false;
    return (
      located.snapshot.projects.length > 1 &&
      !located.snapshot.tasks.some((task) => task.projectId === projectId)
    );
  }

  createTask(workspaceId: string, draft: TodoTaskDraft): TodoTask | null {
    const snapshot = this.snapshot(workspaceId);
    const title = draft.title.trim();
    if (!snapshot || !title || !snapshot.projects.some((item) => item.id === draft.projectId)) {
      return null;
    }
    const now = Date.now();
    const task: TodoTask = {
      id: createTodoId('task'),
      workspaceId,
      projectId: draft.projectId,
      title,
      description: draft.description.trim(),
      acceptanceCriteria: draft.acceptanceCriteria.trim(),
      priority: draft.priority,
      stage: 'todo',
      sortOrder: snapshot.tasks.filter((item) => item.stage === 'todo').length,
      workingDirectory: draft.workingDirectory.trim() || undefined,
      agentType: draft.agentType,
      profileId: draft.profileId,
      modelName: draft.modelName,
      preferredTerminalId: draft.preferredTerminalId?.trim() || undefined,
      executionState: 'idle',
      promptDeliveryState: 'idle',
      attempts: 0,
      recurring: Boolean(draft.recurring),
      runCount: 0,
      validations: [],
      createdAt: now,
      updatedAt: now,
    };
    this.replaceSnapshot({ ...snapshot, tasks: [...snapshot.tasks, task] });
    return task;
  }

  updateTask(taskId: string, draft: TodoTaskDraft): TodoTask | null {
    const located = this.findTask(taskId);
    const title = draft.title.trim();
    if (
      !located ||
      !title ||
      !located.snapshot.projects.some((item) => item.id === draft.projectId)
    ) {
      return null;
    }
    const agentChanged = draft.agentType !== located.task.agentType;
    const updated: TodoTask = {
      ...located.task,
      ...draft,
      title,
      description: draft.description.trim(),
      acceptanceCriteria: draft.acceptanceCriteria.trim(),
      workingDirectory: draft.workingDirectory.trim() || undefined,
      preferredTerminalId: draft.preferredTerminalId?.trim() || undefined,
      recurring: Boolean(draft.recurring),
      terminalId: agentChanged ? undefined : located.task.terminalId,
      nativeSessionId: agentChanged ? undefined : located.task.nativeSessionId,
      nativeSessionAgentType: agentChanged ? undefined : located.task.nativeSessionAgentType,
      accountProfileId: agentChanged ? undefined : located.task.accountProfileId,
      lastTerminalStatus: agentChanged ? undefined : located.task.lastTerminalStatus,
      lastError: agentChanged ? undefined : located.task.lastError,
      promptDeliveryState: agentChanged ? 'idle' : located.task.promptDeliveryState,
      promptDeliveredAt: agentChanged ? undefined : located.task.promptDeliveredAt,
      updatedAt: Date.now(),
    };
    this.replaceTask(located.snapshot, updated);
    return updated;
  }

  deleteTask(taskId: string): boolean {
    const located = this.findTask(taskId);
    if (!located) return false;
    this.replaceSnapshot({
      ...located.snapshot,
      tasks: located.snapshot.tasks.filter((item) => item.id !== taskId),
    });
    return true;
  }

  /**
   * Returns a running task to To do so it can be started again later.
   *
   * The terminal binding is dropped because a stopped task must stop reacting to that terminal:
   * while it is still bound, further status events and output would keep rewriting the run it no
   * longer has. The native session is kept, so the next attempt resumes the same transcript.
   * Interrupting the agent itself belongs to whoever owns the terminal, not to the board.
   */
  /**
   * Halts a run without throwing away what it was bound to.
   *
   * The terminal, its session and the captured output all stay, so the user can pick the same run
   * up again or hand it back to To do afterwards. Stopping used to be the same act as discarding the
   * attempt, which left no way to interrupt an agent and then think about it.
   */
  stopExecution(taskId: string): TodoTask | null {
    const located = this.findTask(taskId);
    if (!located || located.task.stage !== 'executing') return null;
    const task: TodoTask = {
      ...located.task,
      executionState: 'stopped',
      promptDeliveryState: 'idle',
      lastError: undefined,
      updatedAt: Date.now(),
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  /**
   * Drops the current run and puts the task back in To do.
   *
   * Everything describing the attempt goes with it — terminal, output, timings — because the next
   * run starts the task from the beginning rather than continuing this one.
   */
  returnToBacklog(taskId: string): TodoTask | null {
    const located = this.findTask(taskId);
    if (!located || located.task.stage !== 'executing') return null;
    const task: TodoTask = {
      ...located.task,
      stage: 'todo',
      executionState: 'idle',
      promptDeliveryState: 'idle',
      promptDeliveredAt: undefined,
      terminalId: undefined,
      lastTerminalStatus: undefined,
      outputTail: undefined,
      lastError: undefined,
      startedAt: undefined,
      completedAt: undefined,
      updatedAt: Date.now(),
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  /**
   * Records instructions added to a run that is already under way.
   *
   * Editing a task mid-run only ever changed the board: the agent had been told the old wording and
   * never heard the new one. This keeps the task and the agent saying the same thing, and unlike a
   * retry it is not a new attempt — the same run simply learns more.
   */
  amendExecution(request: TodoContinuationRequest): TodoTask | null {
    const located = this.findTask(request.taskId);
    const feedback = request.feedback.trim();
    if (!located || located.task.stage !== 'executing' || !feedback) return null;
    const task: TodoTask = {
      ...located.task,
      description: request.description.trim(),
      acceptanceCriteria: request.acceptanceCriteria.trim(),
      promptDeliveryState: 'pending',
      promptDeliveredAt: undefined,
      lastError: undefined,
      updatedAt: Date.now(),
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  /**
   * Hands a finished routine task back to To do so it can be run again.
   *
   * The previous run is archived into {@link TodoTask.runCount} and everything that described it —
   * terminal binding, output, session — is dropped: a repeatable chore (build / package / release)
   * has to start from a clean run, otherwise the next build would resume the transcript of the last
   * one and report its result. The validation history stays, because it is the record of past runs.
   */
  restartTask(taskId: string): TodoTask | null {
    const located = this.findTask(taskId);
    if (!located || !canRestartTodoTask(located.task)) return null;
    const now = Date.now();
    const task: TodoTask = {
      ...located.task,
      stage: 'todo',
      executionState: 'idle',
      promptDeliveryState: 'idle',
      promptDeliveredAt: undefined,
      terminalId: undefined,
      nativeSessionId: undefined,
      nativeSessionAgentType: undefined,
      lastTerminalStatus: undefined,
      outputTail: undefined,
      lastError: undefined,
      attempts: 0,
      runCount: located.task.runCount + 1,
      lastRunAt: located.task.verifiedAt ?? located.task.completedAt ?? now,
      startedAt: undefined,
      completedAt: undefined,
      verifiedAt: undefined,
      updatedAt: now,
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  beginExecution(
    taskId: string,
    binding: TodoExecutionBinding,
    continuation = false,
  ): TodoTask | null {
    const located = this.findTask(taskId);
    if (!located) return null;
    const now = Date.now();
    const task: TodoTask = {
      ...located.task,
      ...binding,
      nativeSessionAgentType: binding.nativeSessionId ? located.task.agentType : undefined,
      stage: 'executing',
      executionState: 'starting',
      promptDeliveryState: 'pending',
      promptDeliveredAt: undefined,
      lastTerminalStatus: 'STARTING',
      lastError: undefined,
      outputTail: continuation ? located.task.outputTail : undefined,
      attempts: located.task.attempts + 1,
      startedAt: continuation ? (located.task.startedAt ?? now) : now,
      completedAt: undefined,
      verifiedAt: undefined,
      updatedAt: now,
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  markPromptSending(taskId: string, terminalId: string): TodoTask | null {
    const located = this.findTask(taskId);
    if (!located || located.task.terminalId !== terminalId) return null;
    const task: TodoTask = {
      ...located.task,
      promptDeliveryState: 'sending',
      lastError: undefined,
      updatedAt: Date.now(),
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  markPromptDelivered(taskId: string, terminalId: string): TodoTask | null {
    const located = this.findTask(taskId);
    if (!located || located.task.terminalId !== terminalId) return null;
    const now = Date.now();
    const task: TodoTask = {
      ...located.task,
      promptDeliveryState: 'delivered',
      promptDeliveredAt: now,
      lastError: undefined,
      updatedAt: now,
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  setExecutionError(taskId: string, message: string, terminalId?: string): void {
    const located = this.findTask(taskId);
    if (!located || (terminalId && located.task.terminalId !== terminalId)) return;
    this.replaceTask(located.snapshot, {
      ...located.task,
      stage: 'executing',
      executionState: 'failed',
      promptDeliveryState:
        located.task.promptDeliveryState === 'delivered' ? 'delivered' : 'failed',
      lastError: message,
      updatedAt: Date.now(),
    });
  }

  handleTerminalStatus(terminalId: string, status: TerminalStatus, failureMessage?: string): void {
    const located = this.findTaskByTerminal(terminalId);
    if (!located || located.task.stage === 'completed' || located.task.stage === 'verified') return;
    // A run the user stopped keeps that state. An interrupted agent usually prints a little more
    // before it settles, and letting that traffic report "running" again would erase the stop the
    // user just asked for. A terminal that actually went away still counts, because it decides
    // whether the run can be resumed at all.
    if (located.task.executionState === 'stopped' && !TERMINAL_GONE_STATUSES.includes(status)) {
      return;
    }
    this.replaceTask(
      located.snapshot,
      this.taskWithTerminalStatus(located.task, status, Date.now(), failureMessage),
    );
  }

  applyAgentEvent(event: AgentEvent): void {
    const located = this.findTaskByTerminal(event.terminalId);
    if (!located || event.agentType !== located.task.agentType) return;
    const status = EVENT_STATUS[event.eventType];
    const nativeSessionId = event.nativeSessionId ?? located.task.nativeSessionId;
    if (
      nativeSessionId !== located.task.nativeSessionId ||
      (nativeSessionId && located.task.nativeSessionAgentType !== event.agentType)
    ) {
      this.replaceTask(located.snapshot, {
        ...located.task,
        nativeSessionId,
        nativeSessionAgentType: event.agentType,
        updatedAt: Date.now(),
      });
    }
    if (status && !this.firedBeforePromptDelivery(located.task, event, status)) {
      // A reported failure leaves the terminal running, unlike an exit that ends it.
      this.handleTerminalStatus(
        event.terminalId,
        status,
        status === 'FAILED' ? AGENT_FAILED_ERROR : undefined,
      );
    }
  }

  captureTerminalOutput(terminalId: string, data: string): void {
    const located = this.findTaskByTerminal(terminalId);
    if (!located) return;
    const outputTail = stripTerminalControl(`${located.task.outputTail ?? ''}${data}`).slice(
      -OUTPUT_TAIL_LIMIT,
    );
    this.replaceTask(
      located.snapshot,
      { ...located.task, outputTail, updatedAt: Date.now() },
      false,
    );
  }

  markCompleted(taskId: string): TodoTask | null {
    const located = this.findTask(taskId);
    if (!located) return null;
    const now = Date.now();
    const task: TodoTask = {
      ...located.task,
      stage: 'completed',
      executionState: 'completed',
      lastTerminalStatus: 'COMPLETED',
      completedAt: now,
      updatedAt: now,
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  verifyTask(taskId: string, note = ''): TodoTask | null {
    const located = this.findTask(taskId);
    if (!located || located.task.stage !== 'completed') return null;
    const now = Date.now();
    const task: TodoTask = {
      ...located.task,
      stage: 'verified',
      verifiedAt: now,
      updatedAt: now,
      validations: [
        ...located.task.validations,
        { id: createTodoId('validation'), outcome: 'passed', note: note.trim(), createdAt: now },
      ],
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  rejectValidation(request: TodoContinuationRequest): TodoTask | null {
    const located = this.findTask(request.taskId);
    const feedback = request.feedback.trim();
    if (!located || located.task.stage !== 'completed' || !feedback) return null;
    const now = Date.now();
    const task: TodoTask = {
      ...located.task,
      description: request.description.trim(),
      acceptanceCriteria: request.acceptanceCriteria.trim(),
      stage: 'executing',
      executionState: 'starting',
      promptDeliveryState: 'pending',
      promptDeliveredAt: undefined,
      lastError: undefined,
      completedAt: undefined,
      verifiedAt: undefined,
      updatedAt: now,
      validations: [
        ...located.task.validations,
        { id: createTodoId('validation'), outcome: 'failed', note: feedback, createdAt: now },
      ],
    };
    this.replaceTask(located.snapshot, task);
    return task;
  }

  deleteWorkspace(workspaceId: string): void {
    if (!this.snapshotItems()[workspaceId]) return;
    this.snapshotItems.update((items) => {
      const next = { ...items };
      delete next[workspaceId];
      return next;
    });
    this.persist();
  }

  mergeWorkspaces(sourceWorkspaceId: string, targetWorkspace: Workspace): void {
    const source = this.snapshot(sourceWorkspaceId);
    const target = this.ensureWorkspace(targetWorkspace);
    if (!source || sourceWorkspaceId === targetWorkspace.id) return;
    const projectIds = new Set(target.projects.map((item) => item.id));
    const taskIds = new Set(target.tasks.map((item) => item.id));
    const projects = [
      ...target.projects,
      ...source.projects
        .filter((item) => !projectIds.has(item.id))
        .map((item) => ({ ...item, workspaceId: targetWorkspace.id })),
    ];
    const tasks = [
      ...target.tasks,
      ...source.tasks
        .filter((item) => !taskIds.has(item.id))
        .map((item) => ({ ...item, workspaceId: targetWorkspace.id })),
    ];
    this.snapshotItems.update((items) => {
      const next = {
        ...items,
        [targetWorkspace.id]: { ...target, projects, tasks },
      };
      delete next[sourceWorkspaceId];
      return next;
    });
    this.persist();
  }

  private findProject(
    projectId: string,
  ): { snapshot: TodoWorkspaceSnapshot; project: TodoProject } | null {
    for (const snapshot of Object.values(this.snapshotItems())) {
      const project = snapshot.projects.find((candidate) => candidate.id === projectId);
      if (project) return { snapshot, project };
    }
    return null;
  }

  private findTask(taskId: string): { snapshot: TodoWorkspaceSnapshot; task: TodoTask } | null {
    for (const snapshot of Object.values(this.snapshotItems())) {
      const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
      if (task) return { snapshot, task };
    }
    return null;
  }

  private findTaskByTerminal(
    terminalId: string,
  ): { snapshot: TodoWorkspaceSnapshot; task: TodoTask } | null {
    const matches: Array<{ snapshot: TodoWorkspaceSnapshot; task: TodoTask }> = [];
    for (const snapshot of Object.values(this.snapshotItems())) {
      for (const task of snapshot.tasks) {
        if (task.terminalId === terminalId) matches.push({ snapshot, task });
      }
    }
    return (
      matches.sort((left, right) => {
        const stageDifference =
          Number(right.task.stage === 'executing') - Number(left.task.stage === 'executing');
        return stageDifference || right.task.updatedAt - left.task.updatedAt;
      })[0] ?? null
    );
  }

  private taskWithTerminalStatus(
    task: TodoTask,
    status: TerminalStatus,
    now: number,
    failureMessage?: string,
  ): TodoTask {
    const completed = status === 'COMPLETED';
    const failed = TERMINAL_GONE_STATUSES.includes(status);
    return {
      ...task,
      stage: completed ? 'completed' : task.stage,
      executionState: terminalStatusToExecutionState(status, task.promptDeliveryState),
      promptDeliveryState: completed
        ? 'delivered'
        : failed && task.promptDeliveryState !== 'delivered'
          ? 'failed'
          : task.promptDeliveryState,
      promptDeliveredAt: completed && !task.promptDeliveredAt ? now : task.promptDeliveredAt,
      lastTerminalStatus: status,
      lastError: failed ? (failureMessage ?? TERMINAL_ENDED_ERROR) : undefined,
      completedAt: completed ? now : task.completedAt,
      updatedAt: now,
    };
  }

  /**
   * Whether a hook reported the agent getting ready before this run's prompt reached it.
   *
   * Hooks are read on a poll, so the CLI's own start-up — at its prompt, idle — can arrive after
   * the task was already handed over and would pass for an interrupted run. An ending status still
   * counts whenever it fired, because the run cannot go on either way.
   */
  private firedBeforePromptDelivery(
    task: TodoTask,
    event: AgentEvent,
    status: TerminalStatus,
  ): boolean {
    return (
      task.promptDeliveredAt !== undefined &&
      event.createdAt < task.promptDeliveredAt &&
      !TERMINAL_GONE_STATUSES.includes(status)
    );
  }

  /**
   * Fails a task whose prompt never reached its terminal.
   *
   * Delivery is driven by an in-memory arming that does not survive a restart, so a task left
   * waiting on one would otherwise sit in "waiting to send" forever, with no retry offered.
   */
  private taskWithInterruptedPrompt(task: TodoTask, now: number): TodoTask {
    if (task.promptDeliveryState !== 'pending' && task.promptDeliveryState !== 'sending') {
      return task;
    }
    return {
      ...task,
      executionState: 'failed',
      promptDeliveryState: 'failed',
      lastError: PROMPT_INTERRUPTED_ERROR,
      updatedAt: now,
    };
  }

  private replaceTask(snapshot: TodoWorkspaceSnapshot, task: TodoTask, persist = true): void {
    this.replaceSnapshot(
      {
        ...snapshot,
        tasks: snapshot.tasks.map((item) => (item.id === task.id ? task : item)),
      },
      persist,
    );
  }

  private replaceSnapshot(snapshot: TodoWorkspaceSnapshot, persist = true): void {
    this.snapshotItems.update((items) => ({ ...items, [snapshot.workspaceId]: snapshot }));
    if (persist) this.persist();
  }

  private normalizeSnapshot(
    workspace: Workspace,
    snapshot: TodoWorkspaceSnapshot | undefined,
  ): TodoWorkspaceSnapshot {
    if (!snapshot || !Array.isArray(snapshot.projects) || !Array.isArray(snapshot.tasks)) {
      return {
        version: 1,
        workspaceId: workspace.id,
        projects: [defaultTodoProject(workspace)],
        tasks: [],
      };
    }
    const projects =
      snapshot.projects.length > 0 ? snapshot.projects : [defaultTodoProject(workspace)];
    const projectIds = new Set(projects.map((item) => item.id));
    const fallbackProjectId = projects[0].id;
    return {
      version: 1,
      workspaceId: workspace.id,
      projects: projects.map((item) => ({ ...item, workspaceId: workspace.id })),
      tasks: snapshot.tasks.map((task) => ({
        ...task,
        workspaceId: workspace.id,
        projectId: projectIds.has(task.projectId) ? task.projectId : fallbackProjectId,
        executionState: task.executionState ?? 'idle',
        promptDeliveryState:
          task.promptDeliveryState ??
          (task.attempts > 0
            ? task.executionState === 'failed'
              ? 'failed'
              : 'delivered'
            : 'idle'),
        attempts: task.attempts ?? 0,
        recurring: task.recurring ?? false,
        runCount: task.runCount ?? 0,
        validations: task.validations ?? [],
      })),
    };
  }

  private readStoredSnapshots(): Record<string, TodoWorkspaceSnapshot> {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      if (!value) return {};
      const parsed = JSON.parse(value) as Record<string, TodoWorkspaceSnapshot>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private persist(): Promise<void> {
    if (this.repository.enabled()) {
      const snapshots = this.snapshotItems();
      const operations: Array<{
        id: string;
        snapshot: TodoWorkspaceSnapshot | null;
        serialized?: string;
      }> = [];
      for (const [id, snapshot] of Object.entries(snapshots)) {
        const serialized = JSON.stringify(snapshot);
        if (this.queuedSnapshots.get(id) !== serialized) {
          this.queuedSnapshots.set(id, serialized);
          operations.push({ id, snapshot, serialized });
        }
      }
      for (const id of this.queuedSnapshots.keys()) {
        if (!(id in snapshots)) {
          this.queuedSnapshots.delete(id);
          operations.push({ id, snapshot: null });
        }
      }
      if (!operations.length) return this.mutationQueue;
      for (const operation of operations) {
        this.pendingWorkspaceIds.set(
          operation.id,
          (this.pendingWorkspaceIds.get(operation.id) ?? 0) + 1,
        );
      }
      this.mutationQueue = this.mutationQueue.then(async () => {
        let completed = 0;
        try {
          for (const operation of operations) {
            if (operation.snapshot) {
              await this.repository.save(operation.snapshot);
            } else {
              await this.repository.delete(operation.id);
            }
            completed++;
            this.finishPending(operation.id);
          }
          this.storageErrorState.set(null);
        } catch (error) {
          for (const operation of operations.slice(completed)) {
            if (this.queuedSnapshots.get(operation.id) === operation.serialized) {
              this.queuedSnapshots.delete(operation.id);
            }
            this.finishPending(operation.id);
          }
          this.storageErrorState.set(String(error));
        }
      });
      return this.mutationQueue;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshotItems()));
    } catch {
      // The in-memory board remains usable in restricted previews.
    }
    return Promise.resolve();
  }

  private finishPending(workspaceId: string): void {
    const count = (this.pendingWorkspaceIds.get(workspaceId) ?? 1) - 1;
    if (count === 0) this.pendingWorkspaceIds.delete(workspaceId);
    else this.pendingWorkspaceIds.set(workspaceId, count);
  }
}
