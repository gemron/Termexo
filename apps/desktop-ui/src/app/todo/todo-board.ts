import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ModalFocusDirective } from '../shared/modal-focus.directive';
import { AnchoredMenuDirective } from '../shared/anchored-menu.directive';
import { FormsModule } from '@angular/forms';
import { save } from '@tauri-apps/plugin-dialog';

import { I18nService } from '../core/i18n/i18n.service';
import { registerTodoBoardTranslations } from '../core/i18n/todo-board.i18n';
import { TranslatePipe } from '../core/i18n/translate.pipe';
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
  TaskMoreAction,
  TodoTaskDraft,
  canAmendTodoTask,
  canRestartTodoTask,
  canResumeTodoTask,
  isReusableTodoTerminal,
  isTodoAgentTerminal,
  todoWorkingDirectory,
} from '../core/models/todo.models';
import {
  AGENT_ICONS,
  AGENT_LABELS,
  type TerminalSession,
  type Workspace,
} from '../core/models/workspace.models';
import { DirectoryPickerService } from '../core/services/directory-picker.service';
import { TodoService } from '../core/services/todo.service';
import { invoke } from '../core/services/backend-bridge';
import { isTauriRuntime } from '../core/services/tauri-runtime';
import { IconComponent } from '../shared/icon/icon';

registerTodoBoardTranslations();

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
const GROK_OPTION_KEY = 'grok|';

/** The terminal dropdown value that stands for "create one when the task starts". */
const NEW_TERMINAL_OPTION = 'new';
/** The project filter value that stands for "every project in this workspace". */
const ALL_PROJECTS_OPTION = 'all';
const DEFAULT_TASK_PRIORITY: TodoPriority = 'medium';

/** Translation keys for the shared feedback dialog, one set per job it serves. */
const FEEDBACK_DIALOG_COPY = {
  reject: {
    heading: 'taskBoard.feedback.rejectHeading',
    hint: 'taskBoard.feedback.rejectHint',
    feedbackLabel: 'taskBoard.feedback.rejectLabel',
    feedbackPlaceholder: 'taskBoard.feedback.rejectPlaceholder',
    submit: 'taskBoard.feedback.rejectSubmit',
  },
  amend: {
    heading: 'taskBoard.amend',
    hint: 'taskBoard.feedback.amendHint',
    feedbackLabel: 'taskBoard.feedback.amendLabel',
    feedbackPlaceholder: 'taskBoard.feedback.amendPlaceholder',
    submit: 'taskBoard.feedback.amendSubmit',
  },
} as const;

/** How long a run is shown in: the unit that is actually still moving. */
function formatRunDuration(elapsedMs: number, i18n: I18nService): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  if (seconds < 60) return i18n.t('taskBoard.duration.seconds', { seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18n.t('taskBoard.duration.minutes', { minutes });
  return i18n.t('taskBoard.duration.hoursMinutes', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

@Component({
  selector: 'app-todo-board',
  imports: [
    DatePipe,
    ModalFocusDirective,
    AnchoredMenuDirective,
    FormsModule,
    IconComponent,
    TranslatePipe,
  ],
  templateUrl: './todo-board.html',
  styleUrl: './todo-board.scss',
})
export class TodoBoardComponent {
  /** The agents' own marks and names, for the task assignment line. */
  protected readonly agentIcons = AGENT_ICONS;
  protected readonly agentLabels = AGENT_LABELS;

  protected readonly todos = inject(TodoService);
  protected readonly transferBusy = signal(false);
  protected readonly transferMessage = signal('');
  private readonly directoryPicker = inject(DirectoryPickerService);
  private readonly i18n = inject(I18nService);

  readonly workspace = input<Workspace | null>(null);

  protected async exportTasks(): Promise<void> {
    const workspace = this.workspace();
    if (!workspace) return;
    this.transferBusy.set(true);
    this.transferMessage.set('');
    try {
      const contents = this.todos.exportWorkspace(workspace.id);
      const safeName =
        workspace.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 48) || 'workspace';
      const filename = `termexo-tasks-${safeName}.json`;
      if (isTauriRuntime()) {
        const path = await save({
          defaultPath: filename,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!path) return;
        await invoke('write_todo_export', { path, contents });
      } else {
        const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      this.transferMessage.set(this.i18n.t('taskBoard.exportSuccess'));
    } catch (error) {
      this.transferMessage.set(this.i18n.t('taskBoard.transferFailed', { error: String(error) }));
    } finally {
      this.transferBusy.set(false);
    }
  }

  protected async importTasks(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const workspace = this.workspace();
    if (!file || !workspace) return;
    this.transferBusy.set(true);
    this.transferMessage.set('');
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('Task import exceeds the 16 MB limit');
      const count = await this.todos.importWorkspace(workspace, await file.text());
      this.transferMessage.set(this.i18n.t('taskBoard.importSuccess', { count }));
    } catch (error) {
      this.transferMessage.set(this.i18n.t('taskBoard.transferFailed', { error: String(error) }));
    } finally {
      this.transferBusy.set(false);
    }
  }
  readonly terminals = input<readonly TerminalSession[]>([]);
  readonly modelProfiles = input<readonly ModelProfile[]>([]);
  /** CLIs with their own model configuration need no Termexo model profile. */
  readonly openCodeAvailable = input(false);
  readonly grokAvailable = input(false);
  readonly busyTaskId = input<string | null>(null);
  /** Terminals whose startup dialogs are still being answered before the prompt is sent. */
  readonly awaitingTerminalIds = input<readonly string[]>([]);

  readonly executionRequested = output<string>();
  /** Asks the shell to interrupt the agent behind a running task; the board frees the task itself. */
  readonly stopRequested = output<string>();
  readonly resumeRequested = output<string>();
  readonly backlogRequested = output<string>();
  readonly continuationRequested = output<TodoContinuationRequest>();
  /** New instructions for the agent already working on the task. */
  readonly amendRequested = output<TodoContinuationRequest>();
  readonly terminalRequested = output<string>();
  /** Asks the shell to close a terminal the board no longer needs once a run is accepted. */
  readonly terminalCloseRequested = output<string>();

  protected readonly columns = TODO_COLUMNS;
  protected scrollToStage(stage: TodoStage, board: HTMLElement): void {
    board
      .querySelector<HTMLElement>(`[data-stage="${stage}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }
  protected readonly priorities = TODO_PRIORITIES;
  protected readonly routinePresets = TODO_ROUTINE_PRESETS;
  protected readonly newTerminalOption = NEW_TERMINAL_OPTION;
  protected readonly allProjectsOption = ALL_PROJECTS_OPTION;
  protected readonly selectedProjectId = signal(ALL_PROJECTS_OPTION);
  protected readonly draggedTaskId = signal<string | null>(null);
  /** Task id whose secondary-actions menu is open. Only one card shows the menu at a time. */
  protected readonly expandedTaskId = signal<string | null>(null);
  protected moreMenuAnchor: HTMLElement | null = null;
  protected readonly expandedTask = computed(
    () => this.workspaceTasks().find((task) => task.id === this.expandedTaskId()) ?? null,
  );
  /** Task id currently shown in the side drawer. `null` keeps the drawer closed. */
  protected readonly detailTaskId = signal<string | null>(null);
  protected readonly detailTask = computed(() => {
    const id = this.detailTaskId();
    if (!id) return null;
    return this.workspaceTasks().find((task) => task.id === id) ?? null;
  });

  protected openTaskDetail(task: TodoTask): void {
    this.detailTaskId.set(task.id);
  }

  protected closeTaskDetail(): void {
    this.detailTaskId.set(null);
  }

  protected toggleMoreMenu(taskId: string, anchor: HTMLElement): void {
    this.moreMenuAnchor = anchor;
    this.expandedTaskId.update((current) => (current === taskId ? null : taskId));
  }

  /**
   * Returns the secondary actions to surface under the card's "more" menu, or an empty array
   * when the card already has a primary action and nothing else to do. Each entry carries its own
   * i18n keys so the label and tooltip can change per locale without the template having to
   * inline-translate them.
   */
  protected readonly moreActionsFor = (task: TodoTask): readonly TaskMoreAction[] => {
    // Stop and resume are first-class actions that stay on the row; everything else collapses
    // into the "more" menu. "Delete" sits at the end of every menu because the card no longer
    // exposes a dedicated trash button — the drawer is the read-only path, the more menu is
    // the destructive path.
    if (task.stage === 'executing' && !this.canResume(task) && this.canAmend(task)) {
      return [
        {
          key: 'amend',
          labelKey: 'taskBoard.amend',
          icon: 'message',
          titleKey: 'taskBoard.card.amendHint',
        },
        this.deleteAction(),
      ];
    }
    if (task.stage === 'executing' && this.canResume(task)) {
      return [
        {
          key: 'backlog',
          labelKey: 'taskBoard.card.backlog',
          icon: 'rollback',
          titleKey: 'taskBoard.card.backlogHint',
        },
        this.deleteAction(),
      ];
    }
    if (task.stage === 'completed') {
      const actions: TaskMoreAction[] = [];
      const closable = this.closableTerminalFor(task);
      if (closable) {
        actions.push({
          key: 'verify-close',
          labelKey: 'taskBoard.card.verifyClose',
          icon: 'square',
          titleKey: 'taskBoard.card.verifyCloseHint',
          titleParams: { terminal: closable.name },
        });
      }
      actions.push({
        key: 'reject',
        labelKey: 'taskBoard.card.reject',
        icon: 'rollback',
        titleKey: '',
      });
      actions.push(this.deleteAction());
      return actions;
    }
    return [this.deleteAction()];
  };

  /** Common "delete this task" entry used by every stage's "more" menu. */
  private deleteAction(): TaskMoreAction {
    return {
      key: 'delete',
      labelKey: 'taskBoard.deleteTask',
      icon: 'trash',
      titleKey: 'taskBoard.card.deleteWarning',
    };
  }

  /**
   * Translates an action's `titleKey` and `titleParams` into a ready-to-render string. The
   * header attribute only accepts strings, so the interpolation has to happen in TS rather than
   * the template; the resulting string is also fine when `titleKey` is empty.
   */
  protected resolveMoreActionTitle(action: TaskMoreAction): string {
    if (!action.titleKey) {
      return '';
    }
    return action.titleParams
      ? this.i18n.t(action.titleKey, action.titleParams)
      : this.i18n.t(action.titleKey);
  }

  /** Runs the secondary action whose `key` matches and closes the menu. */
  protected runMoreAction(task: TodoTask, key: TaskMoreAction['key']): void {
    this.expandedTaskId.set(null);
    switch (key) {
      case 'backlog':
        this.backlogRequested.emit(task.id);
        return;
      case 'amend':
        this.openAmendment(task);
        return;
      case 'submit':
        this.markCompleted(task);
        return;
      case 'stop':
        this.stopRequested.emit(task.id);
        return;
      case 'reject':
        this.openValidationFailure(task);
        return;
      case 'verify-close':
        this.verify(task, true);
        return;
      case 'delete':
        this.requestTaskDeletion(task);
        return;
    }
  }
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
  /** Optional model for CLIs that manage their own credentials and defaults. */
  protected readonly taskCliModel = signal('');
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

  /** The feedback dialog serves two jobs: rejecting a verification, and amending a live run. */
  protected readonly validationMode = signal<'reject' | 'amend'>('reject');
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
  /** The routine tasks of the current filter, in creation order so the strip never reshuffles. */
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
    // OpenCode and Grok Build bring their own model configuration and credentials.
    if (this.openCodeAvailable()) {
      profileOptions.push({
        key: OPENCODE_OPTION_KEY,
        agentType: 'opencode',
        profileId: '',
        modelName: '',
        label: this.i18n.t('taskBoard.taskDialog.openCodeModelOption'),
      });
    }
    if (this.grokAvailable()) {
      profileOptions.push({
        key: GROK_OPTION_KEY,
        agentType: 'grok',
        profileId: '',
        modelName: '',
        label: this.i18n.t('taskBoard.taskDialog.grokModelOption'),
      });
    }
    return profileOptions;
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
  /**
   * Fields a run in flight cannot change under it — which terminal it runs in, and where.
   *
   * A stopped run is not in flight: nothing is reading its terminal, so those choices open back up
   * without having to throw the attempt away first.
   */
  protected readonly taskExecutionLocked = computed(() => {
    const task = this.editingTask();
    if (!task) return false;
    return (
      task.stage === 'executing' && task.executionState !== 'failed' && !canResumeTodoTask(task)
    );
  });
  /** Wording keys for the shared feedback dialog, so the template carries no branching of its own. */
  protected readonly validationDialogCopy = computed(
    () => FEEDBACK_DIALOG_COPY[this.validationMode()],
  );
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
    if (task.stage === 'executing') {
      return formatRunDuration(this.now() - task.startedAt, this.i18n);
    }
    return this.i18n.t('taskBoard.card.elapsed', {
      duration: formatRunDuration((task.completedAt ?? this.now()) - task.startedAt, this.i18n),
    });
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

  protected detailTerminalLabel(task: TodoTask): string {
    const terminalId = task.terminalId || task.preferredTerminalId;
    if (!terminalId) return this.i18n.t('taskBoard.taskDialog.newTerminalOption');
    return (
      this.terminals().find((terminal) => terminal.id === terminalId)?.name ??
      this.i18n.t('taskBoard.card.terminalUnavailable')
    );
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
    this.taskCliModel.set('');
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
    this.taskCliModel.set(
      task.agentType === 'opencode' || task.agentType === 'grok' ? task.modelName : '',
    );
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
        this.i18n.t('taskBoard.taskDialog.noModelSelected'));
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
          (option?.agentType === 'opencode' || option?.agentType === 'grok'
            ? this.taskCliModel().trim()
            : option?.modelName) ??
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
    this.taskTitle.set(this.i18n.t(preset.titleKey));
    this.taskDescription.set(this.i18n.t(preset.descriptionKey));
    this.taskAcceptance.set(this.i18n.t(preset.acceptanceCriteriaKey));
    this.taskRecurring.set(true);
  }

  protected canRestart(task: TodoTask): boolean {
    return canRestartTodoTask(task);
  }

  /** Whether the quick strip can start this routine task right now. */
  protected canRunRoutine(task: TodoTask): boolean {
    return !this.busyTaskId() && (task.stage === 'todo' || canRestartTodoTask(task));
  }

  /**
   * Runs a routine task, archiving the previous run first when there is one.
   *
   * Both the quick strip and the "run again" card action land here, so a repeat run always goes
   * through the same reset and reaches the shell as an ordinary execution request.
   */
  protected runRoutine(task: TodoTask): void {
    const startable = canRestartTodoTask(task) ? this.todos.restartTask(task.id) : task;
    if (!startable || startable.stage !== 'todo' || this.busyTaskId()) return;
    this.executionRequested.emit(startable.id);
  }

  /** Explains what the click does, and why it is refused while another run is starting. */
  protected routineHint(task: TodoTask): string {
    if (task.stage === 'executing') {
      return this.i18n.t('taskBoard.routine.runningHint', { title: task.title });
    }
    if (this.busyTaskId()) return this.i18n.t('taskBoard.routine.busyHint');
    return this.i18n.t('taskBoard.routine.runHint', {
      title: task.title,
      directory: this.taskDirectory(task),
    });
  }

  /** What the quick strip reports about a routine task without opening its card. */
  protected routineStateLabel(task: TodoTask): string {
    if (task.stage === 'executing') return this.i18n.t('taskBoard.routine.executing');
    if (task.stage === 'completed') return this.i18n.t('taskBoard.routine.awaitingReview');
    if (task.stage === 'verified') return this.i18n.t('taskBoard.routine.runAgain');
    return task.runCount > 0
      ? this.i18n.t('taskBoard.routine.completedRuns', { count: task.runCount })
      : this.i18n.t('taskBoard.routine.neverRun');
  }

  /** A to-do card that has already run is one that was stopped; say so instead of looking new. */
  protected stoppedRunLabel(task: TodoTask): string {
    if (task.stage !== 'todo' || task.attempts === 0) return '';
    return this.i18n.t(
      task.nativeSessionId
        ? 'taskBoard.card.stoppedResumable'
        : 'taskBoard.card.stoppedRestartable',
    );
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
      cliModel: this.taskCliModel(),
      terminalId: this.taskTerminalId(),
      recurring: this.taskRecurring(),
    });
  }

  protected projectDirectory(projectId: string): string {
    return this.projects().find((project) => project.id === projectId)?.path ?? '';
  }

  protected terminalStatusLabel(status: TerminalSession['status']): string {
    const labelKeys: Record<TerminalSession['status'], string> = {
      STARTING: 'taskBoard.terminalStatus.starting',
      RUNNING: 'taskBoard.terminalStatus.running',
      THINKING: 'taskBoard.terminalStatus.thinking',
      WAITING_INPUT: 'taskBoard.terminalStatus.waitingInput',
      WAITING_APPROVAL: 'taskBoard.terminalStatus.waitingApproval',
      RATE_LIMITED: 'taskBoard.terminalStatus.rateLimited',
      IDLE: 'taskBoard.terminalStatus.idle',
      COMPLETED: 'taskBoard.terminalStatus.completed',
      FAILED: 'taskBoard.terminalStatus.failed',
      STOPPED: 'taskBoard.terminalStatus.stopped',
      DISCONNECTED: 'taskBoard.terminalStatus.disconnected',
    };
    return this.i18n.t(labelKeys[status]);
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
    return this.i18n.t(
      this.totalForProject(projectId) > 0
        ? 'taskBoard.projectDialog.deleteBlockedByTasks'
        : 'taskBoard.projectDialog.deleteBlockedLastProject',
    );
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
        this.i18n.t('taskBoard.directoryPickerFailed', {
          error: error instanceof Error ? error.message : String(error),
        }),
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
    if (task?.stage === 'completed' && stage === 'executing') {
      return this.i18n.t('taskBoard.drop.reject');
    }
    const labelKeys: Record<TodoStage, string> = {
      todo: 'taskBoard.drop.todo',
      executing: 'taskBoard.drop.executing',
      completed: 'taskBoard.drop.completed',
      verified: 'taskBoard.drop.verified',
    };
    return this.i18n.t(labelKeys[stage]);
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
   * The terminal is resolved before the task moves on, because verification is what ends the
   * board's claim on it — and only then, so a task already accepted elsewhere never closes a
   * terminal.
   */
  protected verify(task: TodoTask, closeTerminal = false): void {
    const terminalId = closeTerminal ? this.closableTerminalFor(task)?.id : undefined;
    if (!this.todos.verifyTask(task.id)) return;
    if (terminalId) this.terminalCloseRequested.emit(terminalId);
  }

  protected openValidationFailure(task: TodoTask): void {
    this.validationMode.set('reject');
    this.openFeedbackDialog(task);
  }

  /** Opens the same dialog to add instructions to a run that is still going. */
  protected openAmendment(task: TodoTask): void {
    this.validationMode.set('amend');
    this.openFeedbackDialog(task);
  }

  private openFeedbackDialog(task: TodoTask): void {
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
    const request: TodoContinuationRequest = {
      taskId,
      feedback: this.validationFeedback(),
      description: this.validationDescription(),
      acceptanceCriteria: this.validationAcceptance(),
    };
    if (this.validationMode() === 'amend') {
      this.amendRequested.emit(request);
    } else {
      this.continuationRequested.emit(request);
    }
    this.closeValidationFailure();
  }

  protected canResume(task: TodoTask): boolean {
    return canResumeTodoTask(task);
  }

  protected canAmend(task: TodoTask): boolean {
    return canAmendTodoTask(task);
  }

  protected priorityLabel(priority: TodoPriority): string {
    const labelKey = TODO_PRIORITIES.find((item) => item.value === priority)?.labelKey;
    return labelKey ? this.i18n.t(labelKey) : '';
  }

  protected detailProjectName = computed(() => {
    const task = this.detailTask();
    if (!task?.projectId) return '';
    return this.projects().find((project) => project.id === task.projectId)?.name ?? '';
  });

  protected detailStatusLabel = computed(() => {
    const task = this.detailTask();
    return task ? this.i18n.t(`taskBoard.card.stage.${task.stage}`) : '';
  });

  /** Format a task priority as a localized label, mirroring the existing `priorityLabel` API. */
  protected priorityChip(priority: TodoPriority): string {
    return this.priorityLabel(priority);
  }

  protected emptyColumnLabel(stage: TodoStage): string {
    const labelKeys: Record<TodoStage, string> = {
      todo: 'taskBoard.empty.todo',
      executing: 'taskBoard.empty.executing',
      completed: 'taskBoard.empty.completed',
      verified: 'taskBoard.empty.verified',
    };
    return this.i18n.t(labelKeys[stage]);
  }

  protected executionLabel(task: TodoTask): string {
    if (task.promptDeliveryState === 'pending') {
      return this.i18n.t(
        task.terminalId && this.awaitingTerminalIds().includes(task.terminalId)
          ? 'taskBoard.execution.awaitingTerminal'
          : 'taskBoard.execution.pendingDelivery',
      );
    }
    if (task.promptDeliveryState === 'sending') {
      return this.i18n.t('taskBoard.execution.sending');
    }
    if (task.promptDeliveryState === 'failed') {
      return this.i18n.t('taskBoard.execution.deliveryFailed');
    }
    const labelKeys: Record<TodoTask['executionState'], string> = {
      idle: 'taskBoard.execution.idle',
      starting: 'taskBoard.execution.starting',
      running: 'taskBoard.execution.running',
      waiting: 'taskBoard.execution.waiting',
      failed: 'taskBoard.execution.failed',
      completed: 'taskBoard.execution.completed',
      stopped: 'taskBoard.execution.stopped',
    };
    return this.i18n.t(labelKeys[task.executionState]);
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
