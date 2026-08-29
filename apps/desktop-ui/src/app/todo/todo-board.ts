import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import type { ModelProfile } from '../core/models/agent.models';
import { profileModel } from '../core/models/agent.models';
import {
  TODO_COLUMNS,
  TODO_PRIORITIES,
  TODO_ROUTINE_PRESETS,
  TodoContinuationRequest,
  TodoPriority,
  TodoProject,
  TodoRoutinePreset,
  TodoStage,
  TodoTask,
  TodoTaskDraft,
  canRestartTodoTask,
  isReusableTodoTerminal,
  isTodoAgentTerminal,
  todoWorkingDirectory,
} from '../core/models/todo.models';
import type { TerminalSession, Workspace } from '../core/models/workspace.models';
import { DirectoryPickerService } from '../core/services/directory-picker.service';
import { TodoService } from '../core/services/todo.service';
import { IconComponent } from '../shared/icon/icon';

interface ModelOption {
  key: string;
  agentType: TodoTask['agentType'];
  profileId: string;
  modelName: string;
  label: string;
}

type AgentTerminal = TerminalSession & { agentType: TodoTask['agentType'] };

/**
 * The model-dropdown value for OpenCode.
 *
 * OpenCode carries no Termexo model profile, so its option has an empty profile id. That keeps the
 * key identical to the `agentType|profileId` an OpenCode task round-trips through.
 */
const OPENCODE_OPTION_KEY = 'opencode|';

/** The terminal dropdown value that stands for "create one when the task starts". */
const NEW_TERMINAL_OPTION = 'new';
/** The project filter value that stands for "every project in this workspace". */
const ALL_PROJECTS_OPTION = 'all';
const DEFAULT_TASK_PRIORITY: TodoPriority = 'medium';

/** How long a run is shown in: the unit that is actually still moving. */
function formatRunDuration(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

@Component({
  selector: 'app-todo-board',
  imports: [FormsModule, IconComponent],
  templateUrl: './todo-board.html',
  styleUrl: './todo-board.scss',
})
export class TodoBoardComponent {
  protected readonly todos = inject(TodoService);
  private readonly directoryPicker = inject(DirectoryPickerService);

  readonly workspace = input<Workspace | null>(null);
  readonly terminals = input<readonly TerminalSession[]>([]);
  readonly modelProfiles = input<readonly ModelProfile[]>([]);
  /** OpenCode needs no model profile, so its availability alone decides whether it is offered. */
  readonly openCodeAvailable = input(false);
  readonly busyTaskId = input<string | null>(null);
  /** Terminals whose startup dialogs are still being answered before the prompt is sent. */
  readonly awaitingTerminalIds = input<readonly string[]>([]);

  readonly executionRequested = output<string>();
  /** Asks the shell to interrupt the agent behind a running task; the board frees the task itself. */
  readonly stopRequested = output<string>();
  readonly continuationRequested = output<TodoContinuationRequest>();
  readonly terminalRequested = output<string>();
  /** Asks the shell to close a terminal the board no longer needs once a run is accepted. */
  readonly terminalCloseRequested = output<string>();

  protected readonly columns = TODO_COLUMNS;
  protected readonly priorities = TODO_PRIORITIES;
  protected readonly routinePresets = TODO_ROUTINE_PRESETS;
  protected readonly newTerminalOption = NEW_TERMINAL_OPTION;
  protected readonly allProjectsOption = ALL_PROJECTS_OPTION;
  protected readonly selectedProjectId = signal(ALL_PROJECTS_OPTION);
  protected readonly draggedTaskId = signal<string | null>(null);
  protected readonly dropStage = signal<TodoStage | null>(null);
  protected readonly taskDialogOpen = signal(false);
  protected readonly projectDialogOpen = signal(false);
  protected readonly validationTaskId = signal<string | null>(null);
  protected readonly editingTaskId = signal<string | null>(null);
  protected readonly resumeTaskAfterProject = signal(false);
  protected readonly taskDiscardPending = signal(false);
  protected readonly taskDeletePending = signal(false);
  /** The card whose inline "delete this task?" confirmation is showing, if any. */
  protected readonly deleteConfirmTaskId = signal<string | null>(null);
  private readonly taskFormBaseline = signal('');
  /** Whether the collapsed execution settings of the task dialog were opened by hand. */
  private readonly executionSettingsOpened = signal(false);

  protected readonly taskTitle = signal('');
  protected readonly taskDescription = signal('');
  protected readonly taskAcceptance = signal('');
  protected readonly taskPriority = signal<TodoPriority>(DEFAULT_TASK_PRIORITY);
  protected readonly taskProjectId = signal('');
  protected readonly taskWorkingDirectory = signal('');
  protected readonly taskModelKey = signal('');
  /** Free-text `provider/model` for an OpenCode task; blank means OpenCode's own default. */
  protected readonly taskOpenCodeModel = signal('');
  protected readonly taskTerminalId = signal(NEW_TERMINAL_OPTION);
  protected readonly taskRecurring = signal(false);

  protected readonly editingProjectId = signal<string | null>(null);
  protected readonly projectDeletePending = signal(false);
  protected readonly projectName = signal('');
  protected readonly projectPath = signal('');
  protected readonly directoryPickerBusy = signal(false);
  protected readonly directoryError = signal('');

  /** Drives the elapsed-time readout; only ticks while a task is actually running. */
  private readonly now = signal(Date.now());

  protected readonly validationFeedback = signal('');
  protected readonly validationDescription = signal('');
  protected readonly validationAcceptance = signal('');

  protected readonly projects = computed(() => {
    const workspace = this.workspace();
    return workspace ? this.todos.projectsFor(workspace.id) : [];
  });
  protected readonly workspaceTasks = computed(() => {
    const workspace = this.workspace();
    return workspace ? this.todos.tasksFor(workspace.id) : [];
  });
  protected readonly visibleTasks = computed(() => {
    const selectedProjectId = this.selectedProjectId();
    const tasks = this.workspaceTasks();
    return selectedProjectId === ALL_PROJECTS_OPTION
      ? tasks
      : tasks.filter((task) => task.projectId === selectedProjectId);
  });
  /** The 常用任务 of the current filter, in creation order so the strip never reshuffles. */
  protected readonly routineTasks = computed(() =>
    this.visibleTasks()
      .filter((task) => task.recurring)
      .sort((left, right) => left.createdAt - right.createdAt),
  );
  protected readonly visibleSummary = computed(() => {
    const tasks = this.visibleTasks();
    const executing = tasks.filter((task) => task.stage === 'executing').length;
    const review = tasks.filter((task) => task.stage === 'completed').length;
    const verified = tasks.filter((task) => task.stage === 'verified').length;
    return {
      total: tasks.length,
      executing,
      review,
      verified,
      progress: tasks.length === 0 ? 0 : Math.round((verified / tasks.length) * 100),
    };
  });
  protected readonly availableTerminals = computed<AgentTerminal[]>(() => {
    const editingTaskId = this.editingTaskId();
    return this.terminals().filter(
      (terminal): terminal is AgentTerminal =>
        isReusableTodoTerminal(terminal) &&
        !this.awaitingTerminalIds().includes(terminal.id) &&
        !this.isTerminalRunningAnotherTask(terminal.id, editingTaskId),
    );
  });
  protected readonly selectedTaskTerminal = computed<AgentTerminal | null>(() => {
    const terminalId = this.taskTerminalId();
    if (terminalId === NEW_TERMINAL_OPTION) return null;
    return (
      this.terminals().find(
        (terminal): terminal is AgentTerminal =>
          terminal.id === terminalId && isTodoAgentTerminal(terminal),
      ) ?? null
    );
  });
  protected readonly selectedTaskTerminalAvailable = computed(() => {
    const terminalId = this.taskTerminalId();
    return (
      terminalId !== NEW_TERMINAL_OPTION &&
      this.availableTerminals().some((terminal) => terminal.id === terminalId)
    );
  });
  /** A bound terminal missing from the offered list still needs an option, or the select resets. */
  protected readonly taskTerminalUnavailable = computed(
    () => this.taskTerminalId() !== NEW_TERMINAL_OPTION && !this.selectedTaskTerminalAvailable(),
  );
  protected readonly modelOptions = computed<ModelOption[]>(() => {
    const profileOptions = this.modelProfiles().flatMap((profile) => {
      const options: ModelOption[] = [];
      if (profile.claudeEnabled) {
        options.push({
          key: `claude|${profile.id}`,
          agentType: 'claude',
          profileId: profile.id,
          modelName: profileModel(profile, 'claude'),
          label: `Claude · ${profile.name} · ${profileModel(profile, 'claude')}`,
        });
      }
      if (profile.codexEnabled) {
        options.push({
          key: `codex|${profile.id}`,
          agentType: 'codex',
          profileId: profile.id,
          modelName: profileModel(profile, 'codex'),
          label: `Codex · ${profile.name} · ${profileModel(profile, 'codex')}`,
        });
      }
      return options;
    });
    // OpenCode brings its own model and credentials, so being installed is the only condition
    // for offering it; unlike Claude and Codex it needs no Termexo model profile.
    return this.openCodeAvailable()
      ? [
          ...profileOptions,
          {
            key: OPENCODE_OPTION_KEY,
            agentType: 'opencode' as const,
            profileId: '',
            modelName: '',
            label: 'OpenCode · 自有模型配置',
          },
        ]
      : profileOptions;
  });

  /** The agent the model dropdown points at, so the form can offer that agent's own fields. */
  protected readonly selectedTaskAgentType = computed(
    () =>
      this.modelOptions().find((option) => option.key === this.taskModelKey())?.agentType ?? null,
  );
  protected readonly editingTask = computed(() => {
    const taskId = this.editingTaskId();
    return taskId ? this.todos.task(taskId) : null;
  });
  protected readonly taskExecutionLocked = computed(() => {
    const task = this.editingTask();
    return task?.stage === 'executing' && task.executionState !== 'failed';
  });
  protected readonly validationTask = computed(() => {
    const taskId = this.validationTaskId();
    return taskId ? this.todos.task(taskId) : null;
  });
  private readonly hasRunningTask = computed(() =>
    this.workspaceTasks().some((task) => task.stage === 'executing'),
  );

  constructor() {
    effect(() => {
      const workspace = this.workspace();
      if (!workspace) return;
      this.todos.ensureWorkspace(workspace);
      const selected = this.selectedProjectId();
      if (
        selected !== ALL_PROJECTS_OPTION &&
        !this.projects().some((project) => project.id === selected)
      ) {
        this.selectedProjectId.set(ALL_PROJECTS_OPTION);
      }
    });
    // A settled board has no clock to run, so the timer exists only while something executes.
    effect((onCleanup) => {
      if (!this.hasRunningTask()) return;
      const ticker = window.setInterval(() => this.now.set(Date.now()), 1_000);
      onCleanup(() => window.clearInterval(ticker));
    });
  }

  /**
   * The single state a card is coloured by.
   *
   * The terminal status and the execution state used to be shown as two separate lines in two
   * different colours; collapsing them here means one card can only ever make one claim.
   */
  protected runRailState(task: TodoTask): 'active' | 'waiting' | 'failed' | 'done' {
    if (task.stage === 'completed') return 'done';
    if (task.promptDeliveryState === 'failed' || task.executionState === 'failed') return 'failed';
    if (task.executionState === 'waiting') return 'waiting';
    if (task.executionState === 'completed') return 'done';
    return 'active';
  }

  /** Proof that an unattended agent is still moving, and how long it has been at it. */
  protected elapsedLabel(task: TodoTask): string {
    if (!task.startedAt) return '';
    if (task.stage === 'executing') return formatRunDuration(this.now() - task.startedAt);
    return `耗时 ${formatRunDuration((task.completedAt ?? this.now()) - task.startedAt)}`;
  }

  protected tasksFor(stage: TodoStage): TodoTask[] {
    return this.visibleTasks()
      .filter((task) => task.stage === stage)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt - right.createdAt);
  }

  protected totalForProject(projectId: string): number {
    return this.workspaceTasks().filter((task) => task.projectId === projectId).length;
  }

  protected projectFor(task: TodoTask): TodoProject | null {
    return this.projects().find((project) => project.id === task.projectId) ?? null;
  }

  protected taskDirectory(task: TodoTask): string {
    return todoWorkingDirectory(task, this.projectFor(task));
  }

  protected terminalFor(task: TodoTask): TerminalSession | null {
    return task.terminalId
      ? (this.terminals().find((terminal) => terminal.id === task.terminalId) ?? null)
      : null;
  }

  /** Whether a task other than `exceptTaskId` is still executing inside this terminal. */
  private isTerminalRunningAnotherTask(terminalId: string, exceptTaskId: string | null): boolean {
    return this.workspaceTasks().some(
      (task) =>
        task.id !== exceptTaskId && task.stage === 'executing' && task.terminalId === terminalId,
    );
  }

  /**
   * The still-open terminal a finished run can release.
   *
   * Null when the terminal is already gone or when another task is still executing in it, so the
   * board never offers to close a terminal that is doing someone else's work.
   */
  protected closableTerminalFor(task: TodoTask): TerminalSession | null {
    const terminal = this.terminalFor(task);
    return terminal && !this.isTerminalRunningAnotherTask(terminal.id, task.id) ? terminal : null;
  }

  protected openCreateTask(): void {
    const projects = this.projects();
    if (projects.length === 0) {
      this.openCreateProject(true);
      return;
    }
    const selectedProject = this.selectedProjectId();
    const projectId =
      selectedProject !== ALL_PROJECTS_OPTION &&
      projects.some((item) => item.id === selectedProject)
        ? selectedProject
        : projects[0].id;
    this.taskTitle.set('');
    this.taskDescription.set('');
    this.taskAcceptance.set('');
    this.taskPriority.set(DEFAULT_TASK_PRIORITY);
    this.taskProjectId.set(projectId);
    this.taskWorkingDirectory.set(this.projectDirectory(projectId));
    this.taskModelKey.set(this.modelOptions()[0]?.key ?? '');
    this.taskOpenCodeModel.set('');
    this.taskTerminalId.set(NEW_TERMINAL_OPTION);
    this.taskRecurring.set(false);
    this.openTaskDialog(null);
  }

  protected openEditTask(task: TodoTask): void {
    this.taskTitle.set(task.title);
    this.taskDescription.set(task.description);
    this.taskAcceptance.set(task.acceptanceCriteria);
    this.taskPriority.set(task.priority);
    this.taskProjectId.set(task.projectId);
    this.taskWorkingDirectory.set(task.workingDirectory ?? this.projectDirectory(task.projectId));
    this.taskModelKey.set(`${task.agentType}|${task.profileId}`);
    this.taskOpenCodeModel.set(task.agentType === 'opencode' ? task.modelName : '');
    this.taskTerminalId.set(task.preferredTerminalId ?? task.terminalId ?? NEW_TERMINAL_OPTION);
    this.taskRecurring.set(task.recurring);
    this.openTaskDialog(task.id);
  }

  /** Opens the dialog on fields the caller has already filled in, and takes their baseline. */
  private openTaskDialog(taskId: string | null): void {
    this.editingTaskId.set(taskId);
    this.deleteConfirmTaskId.set(null);
    this.directoryError.set('');
    this.taskDiscardPending.set(false);
    this.taskDeletePending.set(false);
    this.executionSettingsOpened.set(false);
    this.taskFormBaseline.set(this.taskFormSignature());
    this.taskDialogOpen.set(true);
  }

  protected closeTaskDialog(): void {
    if (this.hasUnsavedTaskChanges()) {
      this.taskDiscardPending.set(true);
      return;
    }
    this.finishClosingTaskDialog();
  }

  protected keepEditingTask(): void {
    this.taskDiscardPending.set(false);
  }

  protected discardTaskChanges(): void {
    this.finishClosingTaskDialog();
  }

  private finishClosingTaskDialog(): void {
    this.taskDialogOpen.set(false);
    this.editingTaskId.set(null);
    this.taskDiscardPending.set(false);
    this.taskDeletePending.set(false);
    this.taskFormBaseline.set('');
  }

  /** Keeps the directory in step with the project unless it was pointed somewhere else. */
  protected changeTaskProject(projectId: string): void {
    if (this.taskExecutionLocked()) return;
    const previousPath = this.projectDirectory(this.taskProjectId());
    const current = this.taskWorkingDirectory().trim();
    this.taskProjectId.set(projectId);
    if (!this.selectedTaskTerminal() && (!current || current === previousPath)) {
      this.taskWorkingDirectory.set(this.projectDirectory(projectId));
    }
  }

  protected changeTaskTerminal(terminalId: string): void {
    if (this.taskExecutionLocked()) return;
    this.taskTerminalId.set(terminalId);
    if (terminalId === NEW_TERMINAL_OPTION) {
      this.taskWorkingDirectory.set(this.projectDirectory(this.taskProjectId()));
      if (!this.modelOptions().some((option) => option.key === this.taskModelKey())) {
        this.taskModelKey.set(this.modelOptions()[0]?.key ?? '');
      }
      return;
    }
    const terminal = this.selectedTaskTerminal();
    if (!terminal) return;
    this.taskWorkingDirectory.set(terminal.workingDirectory);
    const option = this.modelOptionForTerminal(terminal);
    this.taskModelKey.set(option?.key ?? '');
  }

  protected async browseTaskDirectory(): Promise<void> {
    if (this.taskExecutionLocked()) return;
    const selected = await this.pickDirectory(this.taskWorkingDirectory());
    if (selected) this.taskWorkingDirectory.set(selected);
  }

  /** Whether the form already names somewhere the task can actually run. */
  protected hasExecutionTarget(): boolean {
    const terminalId = this.taskTerminalId();
    if (terminalId === NEW_TERMINAL_OPTION) {
      return this.modelOptions().some((option) => option.key === this.taskModelKey());
    }
    const editingTask = this.editingTask();
    const retainsCurrentBinding = Boolean(
      editingTask &&
      (terminalId === editingTask.terminalId || terminalId === editingTask.preferredTerminalId),
    );
    return (
      retainsCurrentBinding ||
      this.availableTerminals().some((terminal) => terminal.id === terminalId)
    );
  }

  protected canSaveTask(): boolean {
    return Boolean(
      this.taskTitle().trim() &&
      this.taskProjectId() &&
      this.taskWorkingDirectory().trim() &&
      this.hasExecutionTarget(),
    );
  }

  /**
   * Execution settings stay folded away so a new task is just a title and a description.
   *
   * They unfold on their own when the defaults cannot run the task — an unavailable terminal or a
   * workspace with no model profiles — so the reason the save button is dead is never hidden.
   */
  protected executionSettingsExpanded(): boolean {
    return this.executionSettingsOpened() || !this.hasExecutionTarget();
  }

  protected toggleExecutionSettings(): void {
    this.executionSettingsOpened.update((opened) => !opened);
  }

  /** One line naming where and with what the task will run, shown while the settings are folded. */
  protected executionSummary(): string {
    const terminal = this.selectedTaskTerminal();
    const target = terminal
      ? terminal.name
      : (this.modelOptions().find((option) => option.key === this.taskModelKey())?.label ??
        '未选择模型');
    const projectName = this.projects().find(
      (project) => project.id === this.taskProjectId(),
    )?.name;
    return [projectName, target, this.taskWorkingDirectory().trim()]
      .filter((part): part is string => Boolean(part))
      .join(' · ');
  }

  /** Saves with the action the primary button performs, so Ctrl+Enter matches what is on screen. */
  protected submitTaskDialog(): void {
    if (!this.canSaveTask()) return;
    this.saveTask(!this.editingTask());
  }

  protected saveTask(executeAfterSave = false): void {
    const workspace = this.workspace();
    const editingTask = this.editingTask();
    if (!workspace || !this.canSaveTask()) return;
    let draft: TodoTaskDraft;
    if (editingTask && this.taskExecutionLocked()) {
      draft = {
        projectId: editingTask.projectId,
        title: this.taskTitle(),
        description: this.taskDescription(),
        acceptanceCriteria: this.taskAcceptance(),
        priority: this.taskPriority(),
        workingDirectory: editingTask.workingDirectory ?? '',
        agentType: editingTask.agentType,
        profileId: editingTask.profileId,
        modelName: editingTask.modelName,
        preferredTerminalId: editingTask.preferredTerminalId,
        recurring: this.taskRecurring(),
      };
    } else {
      const terminal = this.selectedTaskTerminal();
      const option = terminal
        ? this.modelOptionForTerminal(terminal)
        : this.modelOptions().find((item) => item.key === this.taskModelKey());
      if (!terminal && !option) return;
      const projectId = this.taskProjectId();
      const workingDirectory = this.taskWorkingDirectory().trim();
      draft = {
        projectId,
        title: this.taskTitle(),
        description: this.taskDescription(),
        acceptanceCriteria: this.taskAcceptance(),
        priority: this.taskPriority(),
        workingDirectory:
          !terminal && workingDirectory === this.projectDirectory(projectId).trim()
            ? ''
            : workingDirectory,
        agentType: terminal?.agentType ?? option!.agentType,
        profileId: terminal?.profileId ?? option?.profileId ?? '',
        modelName:
          terminal?.model ??
          (option?.agentType === 'opencode' ? this.taskOpenCodeModel().trim() : option?.modelName) ??
          '',
        preferredTerminalId: terminal?.id,
        recurring: this.taskRecurring(),
      };
    }
    const taskId = this.editingTaskId();
    const savedTask = taskId
      ? this.todos.updateTask(taskId, draft)
      : this.todos.createTask(workspace.id, draft);
    if (!savedTask) return;
    this.finishClosingTaskDialog();
    if (!taskId && executeAfterSave) this.executionRequested.emit(savedTask.id);
  }

  protected deleteEditingTask(): void {
    if (this.taskExecutionLocked()) return;
    if (!this.taskDeletePending()) {
      this.taskDeletePending.set(true);
      return;
    }
    const taskId = this.editingTaskId();
    if (taskId) this.todos.deleteTask(taskId);
    this.finishClosingTaskDialog();
  }

  /** Card-level deletion: the first click asks on the card itself, the second one removes it. */
  protected requestTaskDeletion(task: TodoTask): void {
    this.deleteConfirmTaskId.set(task.id);
  }

  protected cancelTaskDeletion(): void {
    this.deleteConfirmTaskId.set(null);
  }

  /**
   * Removes a task from the board, terminating its run first when it still has one.
   *
   * The stop is emitted before the delete because the shell needs the task's terminal binding to
   * interrupt the agent, and deleting the task takes that binding with it.
   */
  protected confirmTaskDeletion(task: TodoTask): void {
    if (task.stage === 'executing') this.stopRequested.emit(task.id);
    this.todos.deleteTask(task.id);
    this.deleteConfirmTaskId.set(null);
  }

  protected applyRoutinePreset(preset: TodoRoutinePreset): void {
    this.taskTitle.set(preset.title);
    this.taskDescription.set(preset.description);
    this.taskAcceptance.set(preset.acceptanceCriteria);
    this.taskRecurring.set(true);
  }

  protected canRestart(task: TodoTask): boolean {
    return canRestartTodoTask(task);
  }

  /** Whether the quick strip can start this 常用任务 right now. */
  protected canRunRoutine(task: TodoTask): boolean {
    return !this.busyTaskId() && (task.stage === 'todo' || canRestartTodoTask(task));
  }

  /**
   * Runs a 常用任务, archiving the previous run first when there is one.
   *
   * Both the quick strip and the "再次执行" card action land here, so a repeat run always goes
   * through the same reset and reaches the shell as an ordinary execution request.
   */
  protected runRoutine(task: TodoTask): void {
    const startable = canRestartTodoTask(task) ? this.todos.restartTask(task.id) : task;
    if (!startable || startable.stage !== 'todo' || this.busyTaskId()) return;
    this.executionRequested.emit(startable.id);
  }

  /** Explains what the click does, and why it is refused while another run is starting. */
  protected routineHint(task: TodoTask): string {
    if (task.stage === 'executing') return `${task.title} 正在执行，完成后可再次执行`;
    if (this.busyTaskId()) return '正在启动其他任务，请稍候再执行';
    return `执行 ${task.title} · ${this.taskDirectory(task)}`;
  }

  /** What the quick strip reports about a 常用任务 without opening its card. */
  protected routineStateLabel(task: TodoTask): string {
    if (task.stage === 'executing') return '执行中';
    if (task.stage === 'completed') return '待验收';
    if (task.stage === 'verified') return '可再次执行';
    return task.runCount > 0 ? `已完成 ${task.runCount} 次` : '未执行';
  }

  /** A 待办 card that has already run is one that was stopped; say so instead of looking new. */
  protected stoppedRunLabel(task: TodoTask): string {
    if (task.stage !== 'todo' || task.attempts === 0) return '';
    return task.nativeSessionId ? '已终止 · 再次执行将继续原会话' : '已终止 · 可重新执行';
  }

  protected hasUnsavedTaskChanges(): boolean {
    return Boolean(this.taskFormBaseline() && this.taskFormBaseline() !== this.taskFormSignature());
  }

  private taskFormSignature(): string {
    return JSON.stringify({
      title: this.taskTitle(),
      description: this.taskDescription(),
      acceptanceCriteria: this.taskAcceptance(),
      priority: this.taskPriority(),
      projectId: this.taskProjectId(),
      workingDirectory: this.taskWorkingDirectory(),
      modelKey: this.taskModelKey(),
      terminalId: this.taskTerminalId(),
      recurring: this.taskRecurring(),
    });
  }

  protected projectDirectory(projectId: string): string {
    return this.projects().find((project) => project.id === projectId)?.path ?? '';
  }

  protected terminalStatusLabel(status: TerminalSession['status']): string {
    const labels: Record<TerminalSession['status'], string> = {
      STARTING: '启动中',
      RUNNING: '运行中',
      THINKING: '处理中',
      WAITING_INPUT: '等待输入',
      WAITING_APPROVAL: '等待确认',
      RATE_LIMITED: '速率受限',
      IDLE: '空闲',
      COMPLETED: '已完成',
      FAILED: '失败',
      STOPPED: '已停止',
      DISCONNECTED: '已断开',
    };
    return labels[status];
  }

  private modelOptionForTerminal(terminal: AgentTerminal): ModelOption | undefined {
    const candidates = this.modelOptions().filter(
      (option) => option.agentType === terminal.agentType,
    );
    return (
      candidates.find((option) => option.profileId === terminal.profileId) ??
      candidates.find((option) => option.modelName === terminal.model) ??
      candidates[0]
    );
  }

  protected openCreateProject(resumeTaskCreation = false): void {
    const workspace = this.workspace();
    this.resumeTaskAfterProject.set(resumeTaskCreation);
    this.projectDeletePending.set(false);
    this.editingProjectId.set(null);
    this.projectName.set('');
    this.projectPath.set(workspace?.projectPath ?? '');
    this.directoryError.set('');
    this.projectDialogOpen.set(true);
  }

  protected openEditProject(project: TodoProject): void {
    this.resumeTaskAfterProject.set(false);
    this.projectDeletePending.set(false);
    this.editingProjectId.set(project.id);
    this.projectName.set(project.name);
    this.projectPath.set(project.path);
    this.directoryError.set('');
    this.projectDialogOpen.set(true);
  }

  protected closeProjectDialog(): void {
    this.projectDialogOpen.set(false);
    this.editingProjectId.set(null);
    this.resumeTaskAfterProject.set(false);
    this.projectDeletePending.set(false);
  }

  protected canDeleteEditingProject(): boolean {
    const projectId = this.editingProjectId();
    return Boolean(projectId && this.todos.canDeleteProject(projectId));
  }

  /** Explains why an existing project cannot be removed, so the button is never silently inert. */
  protected projectDeleteBlockedReason(): string {
    const projectId = this.editingProjectId();
    if (!projectId || this.canDeleteEditingProject()) return '';
    return this.totalForProject(projectId) > 0
      ? '该项目下仍有任务，请先删除或改派这些任务。'
      : '看板至少需要保留一个项目。';
  }

  protected deleteEditingProject(): void {
    const projectId = this.editingProjectId();
    if (!projectId || !this.canDeleteEditingProject()) return;
    if (!this.projectDeletePending()) {
      this.projectDeletePending.set(true);
      return;
    }
    if (this.todos.deleteProject(projectId) && this.selectedProjectId() === projectId) {
      this.selectedProjectId.set(ALL_PROJECTS_OPTION);
    }
    this.closeProjectDialog();
  }

  protected async browseProjectDirectory(): Promise<void> {
    const selected = await this.pickDirectory(this.projectPath());
    if (selected) this.projectPath.set(selected);
  }

  protected saveProject(): void {
    const workspace = this.workspace();
    if (!workspace) return;
    const draft = { name: this.projectName(), path: this.projectPath() };
    const projectId = this.editingProjectId();
    const project = projectId
      ? this.todos.updateProject(projectId, draft)
      : this.todos.createProject(workspace.id, draft);
    if (!project) return;
    const shouldResumeTask = !projectId && this.resumeTaskAfterProject();
    this.selectedProjectId.set(project.id);
    this.closeProjectDialog();
    if (shouldResumeTask) this.openCreateTask();
  }

  /** The desktop picker is native; the browser preview falls back to a prompt. */
  private async pickDirectory(current: string): Promise<string | null> {
    if (this.directoryPickerBusy()) return null;
    this.directoryPickerBusy.set(true);
    this.directoryError.set('');
    try {
      return await this.directoryPicker.select(current.trim() || this.workspace()?.projectPath);
    } catch (error) {
      this.directoryError.set(
        `无法打开目录选择器：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      this.directoryPickerBusy.set(false);
    }
  }

  protected dragStart(task: TodoTask, event: DragEvent): void {
    if (!this.canDragTask(task)) {
      event.preventDefault();
      return;
    }
    this.draggedTaskId.set(task.id);
    event.dataTransfer?.setData('text/plain', task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  protected dragEnd(): void {
    this.draggedTaskId.set(null);
    this.dropStage.set(null);
  }

  protected allowDrop(stage: TodoStage, event: DragEvent): void {
    if (!this.canDropStage(stage)) return;
    event.preventDefault();
    this.dropStage.set(stage);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  protected drop(stage: TodoStage, event: DragEvent): void {
    event.preventDefault();
    const taskId = event.dataTransfer?.getData('text/plain') || this.draggedTaskId();
    this.dragEnd();
    if (!taskId) return;
    const task = this.todos.task(taskId);
    if (!task || !this.canTransition(task, stage)) return;
    if (stage === 'executing') {
      if (task.stage === 'completed') {
        this.openValidationFailure(task);
      } else if (task.stage === 'todo' || task.executionState === 'failed') {
        this.executionRequested.emit(task.id);
      }
      return;
    }
    if (stage === 'todo') {
      this.todos.restartTask(task.id);
      return;
    }
    if (stage === 'completed' && task.stage === 'executing') {
      this.todos.markCompleted(task.id);
      return;
    }
    if (stage === 'verified' && task.stage === 'completed') {
      this.verify(task);
    }
  }

  protected canDragTask(task: TodoTask): boolean {
    return task.stage !== 'verified' || canRestartTodoTask(task);
  }

  protected canDropStage(stage: TodoStage): boolean {
    const taskId = this.draggedTaskId();
    const task = taskId ? this.todos.task(taskId) : null;
    return task ? this.canTransition(task, stage) : false;
  }

  protected dropActionLabel(stage: TodoStage): string {
    const taskId = this.draggedTaskId();
    const task = taskId ? this.todos.task(taskId) : null;
    if (task?.stage === 'completed' && stage === 'executing') return '退回并继续修改';
    return {
      todo: '放下后放回待办，可再次执行',
      executing: '放下后开始执行',
      completed: '放下后送交验收',
      verified: '放下后验收通过',
    }[stage];
  }

  private canTransition(task: TodoTask, stage: TodoStage): boolean {
    return (
      (canRestartTodoTask(task) && stage === 'todo') ||
      (task.stage === 'todo' && stage === 'executing') ||
      (task.stage === 'executing' && stage === 'completed') ||
      (task.stage === 'completed' && (stage === 'executing' || stage === 'verified'))
    );
  }

  protected requestExecution(task: TodoTask): void {
    this.executionRequested.emit(task.id);
  }

  protected markCompleted(task: TodoTask): void {
    this.todos.markCompleted(task.id);
  }

  /**
   * Accepts a finished run, optionally releasing the terminal it ran in.
   *
   * The terminal is resolved before the task moves on, because 验收 is what ends the board's claim
   * on it — and only then, so a task that was already accepted elsewhere never closes a terminal.
   */
  protected verify(task: TodoTask, closeTerminal = false): void {
    const terminalId = closeTerminal ? this.closableTerminalFor(task)?.id : undefined;
    if (!this.todos.verifyTask(task.id)) return;
    if (terminalId) this.terminalCloseRequested.emit(terminalId);
  }

  protected openValidationFailure(task: TodoTask): void {
    this.validationTaskId.set(task.id);
    this.validationFeedback.set('');
    this.validationDescription.set(task.description);
    this.validationAcceptance.set(task.acceptanceCriteria);
  }

  protected closeValidationFailure(): void {
    this.validationTaskId.set(null);
    this.validationFeedback.set('');
  }

  protected continueAfterFailure(): void {
    const taskId = this.validationTaskId();
    if (!taskId || !this.validationFeedback().trim()) return;
    this.continuationRequested.emit({
      taskId,
      feedback: this.validationFeedback(),
      description: this.validationDescription(),
      acceptanceCriteria: this.validationAcceptance(),
    });
    this.closeValidationFailure();
  }

  protected priorityLabel(priority: TodoPriority): string {
    return TODO_PRIORITIES.find((item) => item.value === priority)?.label ?? '';
  }

  protected emptyColumnLabel(stage: TodoStage): string {
    return {
      todo: '添加第一个任务',
      executing: '开始任务后会显示在这里',
      completed: 'Agent 完成后会等待你验收',
      verified: '验收通过的任务会归档在这里',
    }[stage];
  }

  protected executionLabel(task: TodoTask): string {
    if (task.promptDeliveryState === 'pending') {
      return task.terminalId && this.awaitingTerminalIds().includes(task.terminalId)
        ? '等待终端就绪，随后自动发送'
        : '终端已绑定，等待发送';
    }
    if (task.promptDeliveryState === 'sending') {
      return '正在发送任务到终端';
    }
    if (task.promptDeliveryState === 'failed') {
      return '任务未送达终端';
    }
    const labels = {
      idle: '等待开始',
      starting: '任务已发送，等待 Agent 响应',
      running: 'Agent 执行中',
      waiting: '等待人工处理',
      failed: '执行异常',
      completed: '执行完成',
    } as const;
    return labels[task.executionState];
  }

  /** The last lines the agent printed, kept apart so each truncates like a terminal row. */
  protected latestOutput(task: TodoTask): string[] {
    return (task.outputTail ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-2);
  }
}
