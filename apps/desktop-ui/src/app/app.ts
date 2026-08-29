import {
  Component,
  computed,
  effect,
  HostListener,
  inject,
  signal,
  untracked,
} from '@angular/core';

import {
  AccountProfileInput,
  AgentProtocol,
  BackgroundSessionResolution,
  ClaudeBackgroundSession,
  CliOperationPlan,
  CliOperationRequest,
  CliOperationResult,
  compatibleNativeSessionId,
  McpProfileInput,
  ModelProfileInput,
  needsCredential,
  NetworkProfileInput,
  NetworkTestResult,
  profileModel,
  resolveAccountProfileId,
} from './core/models/agent.models';
import {
  AgentType,
  DEFAULT_TERMINAL_FONT_SIZE,
  LayoutMode,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  normalizeTerminalFontSize,
  normalizeTerminalGridDimension,
  normalizeWorkspaceThemeColor,
  TerminalStatus,
  TerminalSession,
  Workspace,
} from './core/models/workspace.models';
import type { HandoffPackage, HandoffRecord } from './core/models/handoff';
import type { PromptAsset } from './core/models/prompt-assets';
import { AGENT_STARTUP_CONFIRM_KEY } from './core/models/agent-startup';
import { TERMINAL_INPUT_SETTLE_MS, terminalPromptWrites } from './core/models/terminal-input';
import type { TodoContinuationRequest, TodoTask } from './core/models/todo.models';
import {
  compatibleTodoSessionId,
  isReusableTodoTerminal,
  todoWorkingDirectory,
} from './core/models/todo.models';
import { I18nService } from './core/i18n/i18n.service';
import { TranslatePipe } from './core/i18n/translate.pipe';
import {
  clearedNoticeStatus,
  collectGlobalTerminalNotices,
  createAttentionBanner,
  globalNoticeKey,
  GlobalTerminalNotice,
  isWaitingNotice,
} from './core/models/terminal-notifications';
import { createAppThemePalette } from './core/models/theme-palette';
import { AgentService } from './core/services/agent.service';
import { AppStateService } from './core/services/app-state.service';
import { DirectoryPickerService } from './core/services/directory-picker.service';
import { DesktopNotificationService } from './core/services/desktop-notification.service';
import { HandoffService } from './core/services/handoff.service';
import { PromptAssetService } from './core/services/prompt-asset.service';
import { AgentStartupService } from './core/services/agent-startup.service';
import { TodoService } from './core/services/todo.service';
import { isTauriRuntime } from './core/services/tauri-runtime';
import { UpdateCheck, UpdateService } from './core/services/update.service';
import {
  TerminalExitEvent,
  terminalEventMatchesSession,
  TerminalGatewayService,
} from './core/services/terminal-gateway.service';
import { AgentSettingsDialogComponent, SettingsTab } from './dialogs/agent-settings-dialog';
import {
  ClaudeLaunchDialogComponent,
  ClaudeLaunchDialogValue,
} from './dialogs/claude-launch-dialog';
import { CodexLaunchDialogComponent, CodexLaunchDialogValue } from './dialogs/codex-launch-dialog';
import {
  OpenCodeLaunchDialogComponent,
  type OpenCodeLaunchDialogValue,
} from './dialogs/opencode-launch-dialog';
import { CreateWorkspaceDialogComponent } from './dialogs/create-workspace-dialog';
import { BackgroundSessionDialogComponent } from './dialogs/background-session-dialog';
import { DeleteWorkspaceDialogComponent } from './dialogs/delete-workspace-dialog';
import {
  EditWorkspaceDialogComponent,
  WorkspaceAppearanceValue,
} from './dialogs/edit-workspace-dialog';
import { MergeWorkspaceDialogComponent } from './dialogs/merge-workspace-dialog';
import { ModelSwitchDialogComponent, ModelSwitchValue } from './dialogs/model-switch-dialog';
import {
  HandoffDialogComponent,
  type HandoffGenerateRequest,
  type HandoffSendRequest,
} from './dialogs/handoff-dialog';
import { PromptLibraryDialogComponent } from './dialogs/prompt-library-dialog';
import { ResumeSessionValue, SessionCenterDialogComponent } from './dialogs/session-center-dialog';
import { InspectorPanelComponent } from './inspector/inspector-panel';
import { IconComponent } from './shared/icon/icon';
import { LanguageSelectorComponent } from './shared/language-selector/language-selector';
import {
  DEFAULT_TERMINAL_FONT_NAME,
  isTerminalFontAvailable,
  normalizeTerminalFontName,
} from './terminal/terminal-font';
import { AGENT_INTERRUPT_SEQUENCE, workbenchShortcut } from './terminal/terminal-key-sequences';
import {
  layoutTerminalCapacity,
  resolveVisibleTerminalIds,
  revealTerminalInLayout,
} from './terminal/terminal-visibility';
import { TerminalToolbarComponent } from './terminal/terminal-toolbar';
import { TerminalWorkbenchComponent } from './terminal/terminal-workbench';
import { TodoBoardComponent } from './todo/todo-board';
import { WorkspaceSidebarComponent } from './workspace/workspace-sidebar';

type SidebarResizeTarget = 'workspace' | 'inspector';
type WorkspaceView = 'terminal' | 'tasks';

/** How a resume should proceed once the CLI's hold on the session has been dealt with. */
interface BackgroundReclaim {
  /** False when the user chose to leave a running session alone, so nothing is launched. */
  proceed: boolean;
  forkSession: boolean;
  attachShortId?: string;
}

/** `MouseEvent.button` value for the middle button, which closes a tab. */
const MIDDLE_MOUSE_BUTTON = 1;
const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 208;
const WORKSPACE_SIDEBAR_MIN_WIDTH = 168;
const WORKSPACE_SIDEBAR_MAX_WIDTH = 360;
const INSPECTOR_DEFAULT_WIDTH = 280;
const INSPECTOR_MIN_WIDTH = 240;
const INSPECTOR_MAX_WIDTH = 460;
const INSPECTOR_AUTO_COLLAPSE_WIDTH = 900;
const WORKSPACE_SIDEBAR_AUTO_COLLAPSE_WIDTH = 760;
/** Matches the backend default for a profile that has never had a threshold set. */
const DEFAULT_ALERT_THRESHOLD = 80;
/** Checks for model activity often, while the backend cache controls actual provider requests. */
const QUOTA_ACTIVITY_CHECK_INTERVAL_MS = 30_000;
/** Keeps a short completed model turn eligible for the next automatic refresh. */
const QUOTA_RECENT_ACTIVITY_WINDOW_MS = 90_000;
const TERMINAL_FONT_NAME_STORAGE_KEY = 'termexo.terminalFontName';

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch {
    return fallback;
  }
}

function readStoredString(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

@Component({
  selector: 'app-root',
  imports: [
    AgentSettingsDialogComponent,
    ClaudeLaunchDialogComponent,
    CodexLaunchDialogComponent,
    OpenCodeLaunchDialogComponent,
    CreateWorkspaceDialogComponent,
    BackgroundSessionDialogComponent,
    DeleteWorkspaceDialogComponent,
    EditWorkspaceDialogComponent,
    HandoffDialogComponent,
    IconComponent,
    InspectorPanelComponent,
    LanguageSelectorComponent,
    MergeWorkspaceDialogComponent,
    ModelSwitchDialogComponent,
    PromptLibraryDialogComponent,
    SessionCenterDialogComponent,
    TerminalToolbarComponent,
    TerminalWorkbenchComponent,
    TodoBoardComponent,
    TranslatePipe,
    WorkspaceSidebarComponent,
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.scss', './attention-banner.scss'],
  host: {
    'data-theme': 'termexo',
    '[style.--color-primary]': 'workspaceThemePalette().accent',
    '[style.--color-accent]': 'workspaceThemePalette().accent',
    '[style.--accent]': 'workspaceThemePalette().accent',
    '[style.--color-base-100]': 'workspaceThemePalette().surface0',
    '[style.--color-base-200]': 'workspaceThemePalette().surface1',
    '[style.--color-base-300]': 'workspaceThemePalette().surface2',
    '[style.--surface-0]': 'workspaceThemePalette().surface0',
    '[style.--surface-1]': 'workspaceThemePalette().surface1',
    '[style.--surface-2]': 'workspaceThemePalette().surface2',
    '[style.--surface-raised]': 'workspaceThemePalette().surfaceRaised',
    '[style.--surface-inset]': 'workspaceThemePalette().surfaceInset',
    '[style.--sidebar]': 'workspaceThemePalette().sidebar',
    '[style.--primary-soft]': 'workspaceThemePalette().primarySoft',
  },
})
export class App {
  protected readonly state = inject(AppStateService);
  protected readonly agents = inject(AgentService);
  protected readonly i18n = inject(I18nService);
  protected readonly updates = inject(UpdateService);
  private readonly directoryPicker = inject(DirectoryPickerService);
  private readonly desktopNotifications = inject(DesktopNotificationService);
  private readonly terminalGateway = inject(TerminalGatewayService);
  protected readonly promptAssets = inject(PromptAssetService);
  protected readonly handoffs = inject(HandoffService);
  protected readonly todos = inject(TodoService);
  protected readonly agentStartup = inject(AgentStartupService);
  private readonly handledEventKeys = new Set<string>();
  private readonly handledPlanAlertKeys = new Set<string>();
  private readonly eventStatusCutoff = Date.now();
  private readonly preferredTerminalIds = signal<Record<string, string[]>>({});
  private readonly mountedWorkspaceIds = signal<string[]>([]);
  private previousGlobalNoticeKeys = new Set<string>();
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private previousViewportWidth = Number.POSITIVE_INFINITY;

  protected readonly createWorkspaceOpen = signal(false);
  protected readonly workspaceView = signal<WorkspaceView>('terminal');
  protected readonly busyTodoTaskId = signal<string | null>(null);
  protected readonly editingWorkspaceId = signal<string | null>(null);
  protected readonly claudeLaunchOpen = signal(false);
  protected readonly codexLaunchOpen = signal(false);
  protected readonly openCodeLaunchOpen = signal(false);
  protected readonly sessionCenterOpen = signal(false);
  protected readonly promptLibraryOpen = signal(false);
  protected readonly handoffOpen = signal(false);
  protected readonly handoffPreview = signal<HandoffPackage | null>(null);
  protected readonly settingsOpen = signal(false);
  protected readonly settingsInitialTab = signal<SettingsTab>('diagnostics');
  protected readonly settingsInitialModelProfileId = signal('');
  protected readonly modelSwitchOpen = signal(false);
  /** Terminal the switch applies to; null means every terminal of that agent type. */
  protected readonly modelSwitchTerminalId = signal<string | null>(null);
  /** Agent type to preselect when the switch targets one terminal. */
  protected readonly modelSwitchAgentType = signal<AgentProtocol | null>(null);
  /** Name of the single target, so the dialog can say which terminal it will change. */
  protected readonly modelSwitchTerminalName = computed(() => {
    const terminalId = this.modelSwitchTerminalId();
    if (!terminalId) {
      return '';
    }
    return (
      this.state.activeWorkspace()?.terminals.find((item) => item.id === terminalId)?.name ?? ''
    );
  });
  /** Profile currently running in the one-terminal switcher. Batch switches have no single current item. */
  protected readonly modelSwitchCurrentProfileId = computed(() => {
    const terminalId = this.modelSwitchTerminalId();
    if (!terminalId) {
      return '';
    }
    return (
      this.state.activeWorkspace()?.terminals.find((item) => item.id === terminalId)?.profileId ??
      ''
    );
  });
  protected readonly agentMenuOpen = signal(false);
  /** Background sessions awaiting the user's decision; empty closes the dialog. */
  protected readonly backgroundSessions = signal<readonly ClaudeBackgroundSession[]>([]);
  private backgroundSessionResolver: ((resolution: BackgroundSessionResolution) => void) | null =
    null;
  /** The tab being dragged, which also tells the strip a reorder is in progress. */
  protected readonly draggedTerminalId = signal<string | null>(null);
  /** The gap the dragged tab would drop into, counted between tabs rather than over them. */
  protected readonly tabDropIndex = signal<number | null>(null);
  protected readonly workspaceSidebarOpen = signal(
    readStoredBoolean('termexo.workspaceSidebarOpen', true),
  );
  protected readonly inspectorOpen = signal(readStoredBoolean('termexo.inspectorOpen', true));
  protected readonly terminalFontSize = signal(
    readStoredWidth(
      'termexo.terminalFontSize',
      DEFAULT_TERMINAL_FONT_SIZE,
      MIN_TERMINAL_FONT_SIZE,
      MAX_TERMINAL_FONT_SIZE,
    ),
  );
  protected readonly terminalFontName = signal(
    this.availableTerminalFontName(
      readStoredString(TERMINAL_FONT_NAME_STORAGE_KEY, DEFAULT_TERMINAL_FONT_NAME),
    ),
  );
  protected readonly workspaceSidebarWidth = signal(
    readStoredWidth(
      'termexo.workspaceSidebarWidth',
      WORKSPACE_SIDEBAR_DEFAULT_WIDTH,
      WORKSPACE_SIDEBAR_MIN_WIDTH,
      WORKSPACE_SIDEBAR_MAX_WIDTH,
    ),
  );
  protected readonly inspectorWidth = signal(
    readStoredWidth(
      'termexo.inspectorWidth',
      INSPECTOR_DEFAULT_WIDTH,
      INSPECTOR_MIN_WIDTH,
      INSPECTOR_MAX_WIDTH,
    ),
  );
  protected readonly resizingSidebar = signal<SidebarResizeTarget | null>(null);
  protected readonly workspaceMaximized = signal(false);
  protected readonly terminalMaximized = signal(false);
  protected readonly layoutRevision = signal(0);
  protected readonly launchingClaude = signal(false);
  protected readonly launchingCodex = signal(false);
  protected readonly launchingOpenCode = signal(false);
  protected readonly updateInstalling = signal(false);
  /** Stable reference so the session center input does not change every check. */
  protected readonly sessionLaunchProfiles = (nativeSessionId: string) =>
    this.state.findSessionLaunchProfiles(nativeSessionId);
  protected readonly selectedTerminalDirectory = signal<string | null>(null);
  protected readonly toastMessage = signal<string | null>(null);
  protected readonly toastTone = signal<'success' | 'attention'>('success');
  protected readonly globalNoticeOpen = signal(false);
  protected readonly dismissedNoticeKeys = signal<ReadonlySet<string>>(new Set());
  protected readonly workspacePendingDeletion = signal<Workspace | null>(null);
  protected readonly deletingWorkspace = signal(false);
  protected readonly workspacePendingMerge = signal<Workspace | null>(null);
  protected readonly mergingWorkspace = signal(false);
  protected readonly networkTestResult = signal<NetworkTestResult | null>(null);
  protected readonly cliOperationPlan = signal<CliOperationPlan | null>(null);
  protected readonly cliOperationResult = signal<CliOperationResult | null>(null);
  protected readonly activeTerminalId = computed(() => this.state.activeTerminal()?.id ?? null);
  protected readonly activeTodoCount = computed(() => {
    const workspaceId = this.state.activeWorkspace()?.id;
    return workspaceId ? this.todos.tasksFor(workspaceId).length : 0;
  });
  protected readonly activePromptAssets = computed(() =>
    this.promptAssets.forWorkspace(this.state.activeWorkspace()?.id ?? ''),
  );
  protected readonly activeHandoffRecords = computed(() =>
    this.handoffs.forWorkspace(this.state.activeWorkspace()?.id ?? ''),
  );
  protected readonly activeAgentTerminals = computed(
    () =>
      this.state
        .activeWorkspace()
        ?.terminals.filter(
          (
            terminal,
          ): terminal is TerminalSession & { agentType: 'claude' | 'codex' | 'opencode' } =>
            terminal.agentType !== 'shell',
        ) ?? [],
  );
  protected readonly handoffSourceTerminalId = computed(() => {
    const active = this.state.activeTerminal();
    return active?.agentType !== 'shell'
      ? (active?.id ?? null)
      : (this.activeAgentTerminals()[0]?.id ?? null);
  });
  protected readonly mountedWorkspaces = computed(() => {
    const mountedIds = new Set(this.mountedWorkspaceIds());
    return this.state.workspaces().filter((workspace) => mountedIds.has(workspace.id));
  });
  protected readonly globalTerminalNotices = computed(() =>
    collectGlobalTerminalNotices(this.state.workspaces()),
  );
  protected readonly globalWaitingNoticeCount = computed(
    () => this.globalTerminalNotices().filter((notice) => notice.status !== 'COMPLETED').length,
  );
  protected readonly globalCompletedNoticeCount = computed(
    () => this.globalTerminalNotices().filter((notice) => notice.status === 'COMPLETED').length,
  );
  protected readonly attentionBanner = computed(() => {
    const dismissed = this.dismissedNoticeKeys();
    return createAttentionBanner(
      this.globalTerminalNotices().filter((notice) => !dismissed.has(globalNoticeKey(notice))),
      (key, params) => this.i18n.t(key, params),
    );
  });
  protected readonly globalNoticeSummary = computed(() => {
    const waiting = this.globalWaitingNoticeCount();
    const completed = this.globalCompletedNoticeCount();
    return [
      waiting ? this.i18n.t('notice.waitingCount', { count: waiting }) : '',
      completed ? this.i18n.t('notice.completedCount', { count: completed }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });
  protected readonly editingWorkspace = computed(
    () =>
      this.state.workspaces().find((workspace) => workspace.id === this.editingWorkspaceId()) ??
      null,
  );
  protected readonly workspaceThemeColor = computed(() =>
    normalizeWorkspaceThemeColor(this.state.activeWorkspace()?.themeColor),
  );
  protected readonly workspaceThemePalette = computed(() =>
    createAppThemePalette(this.workspaceThemeColor()),
  );
  protected readonly gridColumns = computed(() =>
    normalizeTerminalGridDimension(this.state.activeWorkspace()?.gridColumns),
  );
  protected readonly gridRows = computed(() =>
    normalizeTerminalGridDimension(this.state.activeWorkspace()?.gridRows),
  );
  protected statusLabel(status: TerminalStatus): string {
    const keys: Record<TerminalStatus, string> = {
      STARTING: 'status.starting',
      RUNNING: 'status.running',
      THINKING: 'status.thinking',
      WAITING_INPUT: 'status.waitingInput',
      WAITING_APPROVAL: 'status.waitingApproval',
      RATE_LIMITED: 'status.rateLimited',
      IDLE: 'status.idle',
      COMPLETED: 'status.completed',
      FAILED: 'status.failed',
      STOPPED: 'status.stopped',
      DISCONNECTED: 'status.disconnected',
    };
    return this.i18n.t(keys[status]);
  }
  protected readonly visibleTerminalIds = computed(() => {
    const workspace = this.state.activeWorkspace();
    if (!workspace) {
      return [];
    }
    return resolveVisibleTerminalIds(
      workspace.terminals,
      this.activeTerminalId(),
      this.preferredTerminalIds()[workspace.id] ?? [],
      workspace.layout,
      this.terminalMaximized(),
      this.gridColumns(),
      this.gridRows(),
    );
  });

  constructor() {
    this.adaptLayoutToViewport();
    void this.initialize();
    effect(() => {
      for (const event of [...this.agents.events()].reverse()) {
        if (!this.handledEventKeys.has(event.eventKey)) {
          this.handledEventKeys.add(event.eventKey);
          if (event.createdAt >= this.eventStatusCutoff) {
            this.state.applyAgentEvent(event);
            this.todos.applyAgentEvent(event);
          }
        }
      }
    });
    effect(() => {
      const notices = this.globalTerminalNotices();
      const currentKeys = new Set(notices.map(globalNoticeKey));
      const newNotices = notices.filter(
        (notice) => !this.previousGlobalNoticeKeys.has(globalNoticeKey(notice)),
      );
      this.previousGlobalNoticeKeys = currentKeys;
      this.forgetResolvedDismissals(currentKeys);
      if (newNotices.length > 0) {
        void this.desktopNotifications.notify(newNotices);
      }

      // Waiting terminals are surfaced by the persistent attention banner instead, so the
      // transient toast only reports completions.
      const completed = newNotices.filter((notice) => !isWaitingNotice(notice));
      if (completed.length === 1) {
        const notice = completed[0];
        this.showToast(
          this.i18n.t('notice.completedToast', {
            workspace: notice.workspaceName,
            terminal: notice.terminalName,
          }),
        );
      } else if (completed.length > 1) {
        this.showToast(this.i18n.t('notice.agentsCompleted', { count: completed.length }));
      }
    });
    void this.terminalGateway.onExit((event) => this.handleTerminalExit(event));
    // Reads allowances when the panel opens, then keeps them current while the selected model is
    // producing Agent events. The non-forced refresh preserves the backend's provider-specific
    // cache windows; the button remains the explicit way to bypass those caches.
    effect((onCleanup) => {
      if (!this.inspectorOpen()) return;
      untracked(() => void this.refreshProviderQuotas());
      const timer = window.setInterval(() => {
        const terminal = this.state.activeTerminal();
        if (!terminal || terminal.agentType === 'shell') return;
        const activityCutoff = Date.now() - QUOTA_RECENT_ACTIVITY_WINDOW_MS;
        const recentlyActive = this.agents
          .events()
          .some((event) => event.terminalId === terminal.id && event.createdAt >= activityCutoff);
        if (recentlyActive) {
          void this.refreshProviderQuotas();
        }
      }, QUOTA_ACTIVITY_CHECK_INTERVAL_MS);
      onCleanup(() => window.clearInterval(timer));
    });
    // Warns once per reading that crosses a profile's threshold. Every number here comes from the
    // provider, so a profile whose allowance cannot be read never raises an alert.
    effect(() => {
      const thresholds = new Map(
        this.agents
          .modelProfiles()
          .map((profile) => [profile.id, profile.planAlertThreshold ?? DEFAULT_ALERT_THRESHOLD]),
      );
      for (const quota of this.agents.providerQuotas()) {
        const threshold = thresholds.get(quota.profileId) ?? DEFAULT_ALERT_THRESHOLD;
        for (const entry of quota.entries) {
          if (entry.percent === undefined || entry.percent < threshold) continue;
          // The reset time distinguishes one billing window from the next, so the same window
          // warns once while the window after it can warn again.
          const key = `${quota.profileId}:${entry.label}:${entry.resetsAt ?? 0}:${threshold}`;
          if (this.handledPlanAlertKeys.has(key)) continue;
          this.handledPlanAlertKeys.add(key);
          this.showToast(
            this.i18n.t('quota.thresholdAlert', {
              name: quota.profileName,
              label: entry.label,
              percent: Math.round(entry.percent),
            }),
            'attention',
          );
        }
      }
    });
  }

  /**
   * Marks a terminal whose process ended, and says so when it failed.
   *
   * An agent that never starts — a missing executable, a rejected credential, a CLI that exits
   * immediately — otherwise leaves a tile sitting at "running" with nothing behind it.
   */
  private handleTerminalExit(event: TerminalExitEvent): void {
    const terminal = this.state
      .workspaces()
      .flatMap((workspace) => workspace.terminals)
      .find((item) => item.id === event.terminalId);
    if (!terminal) {
      return;
    }
    if (!terminalEventMatchesSession(event, terminal)) {
      return;
    }
    const status = event.success ? 'STOPPED' : 'FAILED';
    this.state.updateTerminalStatus(event.terminalId, status);
    this.todos.handleTerminalStatus(event.terminalId, status);
    this.agentStartup.cancel(event.terminalId);
    if (event.success) {
      return;
    }
    this.showToast(
      this.i18n.t('terminal.exitFailed', {
        name: terminal.name,
        code: event.exitCode,
      }),
      'attention',
    );
  }

  /** `force` skips the backend's short-lived cache, for the panel's refresh button. */
  protected async refreshProviderQuotas(force = false): Promise<void> {
    await this.agents.refreshProviderQuotas(this.state.activeWorkspace()?.id, force);
  }

  protected async createTerminal(agentType: AgentType): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = await this.selectTerminalDirectory();
    if (!workingDirectory) {
      return;
    }

    const terminal = this.state.createTerminal({ agentType, workingDirectory });
    if (terminal) {
      this.showToast(this.i18n.t('terminal.created', { name: terminal.name }));
    }
  }

  protected async openClaudeLaunch(): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = await this.selectTerminalDirectory();
    if (!workingDirectory) {
      return;
    }

    this.selectedTerminalDirectory.set(workingDirectory);
    this.claudeLaunchOpen.set(true);
  }

  protected async openCodexLaunch(): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = await this.selectTerminalDirectory();
    if (!workingDirectory) {
      return;
    }
    this.selectedTerminalDirectory.set(workingDirectory);
    this.codexLaunchOpen.set(true);
  }

  protected async openOpenCodeLaunch(): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = await this.selectTerminalDirectory();
    if (!workingDirectory) {
      return;
    }
    this.selectedTerminalDirectory.set(workingDirectory);
    this.openCodeLaunchOpen.set(true);
  }

  protected async launchOpenCode(value: OpenCodeLaunchDialogValue): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const workingDirectory = this.selectedTerminalDirectory();
    if (!workspace || !workingDirectory || this.launchingOpenCode()) {
      return;
    }
    if (!this.agents.openCodeInstallation()) {
      await this.agents.detectOpenCode();
    }
    const installation = this.agents.openCodeInstallation();
    if (!installation?.healthy) {
      this.showToast(installation?.diagnostic ?? '未检测到 OpenCode。', 'attention');
      return;
    }

    const terminalId = crypto.randomUUID();
    this.launchingOpenCode.set(true);
    try {
      const launch = await this.agents.prepareOpenCodeLaunch({
        terminalId,
        workspaceId: workspace.id,
        model: value.model,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'opencode',
        name: value.name || undefined,
        command: launch.command,
        model: value.model ?? 'OpenCode 默认模型',
        workingDirectory,
      });
      this.openCodeLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.showToast(this.i18n.t('terminal.started', { name: terminal.name }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    } finally {
      this.launchingOpenCode.set(false);
    }
  }

  protected closeOpenCodeLaunch(): void {
    this.openCodeLaunchOpen.set(false);
    this.selectedTerminalDirectory.set(null);
  }

  protected async launchCodex(value: CodexLaunchDialogValue): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const workingDirectory = this.selectedTerminalDirectory();
    if (!workspace || !workingDirectory || this.launchingCodex()) {
      return;
    }

    if (!this.agents.codexInstallation()) {
      await this.agents.detectCodex();
    }
    const installation = this.agents.codexInstallation();
    if (!installation?.healthy) {
      this.showToast(installation?.diagnostic ?? this.i18n.t('common.codexNotDetected'));
      return;
    }

    const terminalId = crypto.randomUUID();
    this.launchingCodex.set(true);
    try {
      const profile = value.profileId
        ? this.agents.modelProfiles().find((item) => item.id === value.profileId)
        : undefined;
      const launch = await this.agents.prepareCodexLaunch({
        terminalId,
        workspaceId: workspace.id,
        model: value.model,
        profileId: value.profileId,
        accountProfileId: value.accountProfileId,
        autoConfirm: value.autoConfirm,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'codex',
        name: value.name || undefined,
        command: launch.command,
        model:
          (profile ? profileModel(profile, 'codex') : undefined) ??
          value.model ??
          this.i18n.t('terminal.defaultCodexModel'),
        workingDirectory,
        profileId: value.profileId,
        accountProfileId: value.accountProfileId,
        autoConfirm: value.autoConfirm,
      });
      this.codexLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.showToast(this.i18n.t('terminal.started', { name: terminal.name }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error));
    } finally {
      this.launchingCodex.set(false);
    }
  }

  protected closeCodexLaunch(): void {
    this.codexLaunchOpen.set(false);
    this.selectedTerminalDirectory.set(null);
  }

  protected async launchClaude(value: ClaudeLaunchDialogValue): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const workingDirectory = this.selectedTerminalDirectory();
    if (!workspace || !workingDirectory || this.launchingClaude()) {
      return;
    }

    const profile = this.agents.modelProfiles().find((item) => item.id === value.profileId);
    if (profile && needsCredential(profile, 'claude')) {
      this.openModelCredentialSettings(profile.id, profile.name);
      return;
    }

    const terminalId = crypto.randomUUID();
    this.launchingClaude.set(true);
    try {
      const launch = await this.agents.prepareLaunch({
        terminalId,
        workspaceId: workspace.id,
        name: value.name || undefined,
        profileId: value.profileId,
        mcpProfileId: value.mcpProfileId,
        accountProfileId: value.accountProfileId,
        autoConfirm: value.autoConfirm,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'claude',
        name: value.name || undefined,
        command: launch.command,
        model: profile ? profileModel(profile, 'claude') : 'Claude Sonnet',
        workingDirectory,
        profileId: value.profileId,
        mcpProfileId: value.mcpProfileId,
        accountProfileId: value.accountProfileId,
        autoConfirm: value.autoConfirm,
      });
      this.claudeLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.showToast(this.i18n.t('terminal.started', { name: terminal.name }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error));
    } finally {
      this.launchingClaude.set(false);
    }
  }

  protected closeClaudeLaunch(): void {
    this.claudeLaunchOpen.set(false);
    this.selectedTerminalDirectory.set(null);
  }

  protected async openSessionCenter(): Promise<void> {
    this.sessionCenterOpen.set(true);
    await this.refreshSessions(this.state.activeWorkspace()?.projectPath);
  }

  protected async refreshSessions(projectPath?: string): Promise<void> {
    await this.agents.refreshSessions(projectPath);
  }

  protected async resumeAgent(value: ResumeSessionValue): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const agentType = value.session.agentType;
    const launching =
      agentType === 'claude'
        ? this.launchingClaude
        : agentType === 'codex'
          ? this.launchingCodex
          : this.launchingOpenCode;
    if (!workspace || launching()) {
      return;
    }

    const profile =
      agentType === 'opencode'
        ? undefined
        : this.agents.modelProfiles().find((item) => item.id === value.profileId);
    if (profile && needsCredential(profile, agentType === 'claude' ? 'claude' : 'codex')) {
      this.openModelCredentialSettings(profile.id, profile.name);
      return;
    }

    const terminalId = crypto.randomUUID();
    launching.set(true);
    try {
      const reclaim: BackgroundReclaim =
        agentType === 'claude'
          ? await this.reclaimBackgroundSession(value.session.nativeSessionId)
          : { proceed: true, forkSession: false };
      if (!reclaim.proceed) {
        return;
      }
      const launch =
        agentType === 'claude'
          ? await this.agents.prepareLaunch({
              terminalId,
              workspaceId: workspace.id,
              sessionId: value.session.nativeSessionId,
              profileId: value.profileId,
              mcpProfileId: value.mcpProfileId,
              accountProfileId: value.accountProfileId,
              autoConfirm: value.autoConfirm,
              forkSession: reclaim.forkSession,
              attachShortId: reclaim.attachShortId,
            })
          : agentType === 'codex'
            ? await this.agents.prepareCodexLaunch({
                terminalId,
                workspaceId: workspace.id,
                sessionId: value.session.nativeSessionId,
                model: value.model,
                profileId: value.profileId,
                accountProfileId: value.accountProfileId,
                autoConfirm: value.autoConfirm,
              })
            : await this.agents.prepareOpenCodeLaunch({
                terminalId,
                workspaceId: workspace.id,
                sessionId: value.session.nativeSessionId,
                model: value.model,
              });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: value.session.agentType,
        name: value.session.title,
        command: launch.command,
        model:
          (profile
            ? profileModel(profile, agentType === 'claude' ? 'claude' : 'codex')
            : undefined) ??
          value.model ??
          value.session.modelName ??
          (agentType === 'claude'
            ? 'Claude Sonnet'
            : agentType === 'codex'
              ? this.i18n.t('terminal.defaultCodexModel')
              : 'OpenCode 默认模型'),
        nativeSessionId: value.session.nativeSessionId,
        workingDirectory: value.session.projectPath ?? workspace.projectPath,
        profileId: value.profileId,
        mcpProfileId: agentType === 'claude' ? value.mcpProfileId : undefined,
        accountProfileId: agentType === 'opencode' ? undefined : value.accountProfileId,
        autoConfirm: value.autoConfirm,
      });
      this.sessionCenterOpen.set(false);
      if (terminal) {
        this.showToast(this.i18n.t('terminal.resuming', { name: value.session.title }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error));
    } finally {
      launching.set(false);
    }
  }

  protected closeTerminal(terminalId: string): void {
    const workspace = this.state.activeWorkspace();
    if (
      this.terminalMaximized() &&
      this.activeTerminalId() === terminalId &&
      workspace?.terminals.length === 1
    ) {
      this.terminalMaximized.set(false);
    }
    this.agentStartup.cancel(terminalId);
    this.todos.handleTerminalStatus(terminalId, 'STOPPED');
    void this.terminalGateway.close(terminalId).catch(() => undefined);
    this.state.closeTerminal(terminalId);
  }

  protected selectTerminal(terminalId: string): void {
    const workspace = this.state.activeWorkspace();
    if (!workspace) {
      return;
    }
    if (!this.terminalMaximized()) {
      const preferredIds = revealTerminalInLayout(
        this.visibleTerminalIds(),
        this.activeTerminalId(),
        terminalId,
        workspace.layout,
        this.gridColumns(),
        this.gridRows(),
      );
      this.preferredTerminalIds.update((items) => ({ ...items, [workspace.id]: preferredIds }));
    }
    this.state.selectTerminal(terminalId);
    this.scrollTabIntoView(terminalId);
  }

  protected handleTerminalInput(event: { terminalId: string; data: string }): void {
    const located = this.findTerminal(event.terminalId);
    if (located) {
      this.promptAssets.captureInput(located.workspace, located.terminal, event.data);
    }
  }

  protected handleTerminalOutput(event: { terminalId: string; data: string }): void {
    this.handoffs.captureOutput(event.terminalId, event.data);
    this.todos.captureTerminalOutput(event.terminalId, event.data);
    this.agentStartup.ingest(event.terminalId, event.data);
  }

  protected handleTerminalStatus(event: { terminalId: string; status: TerminalStatus }): void {
    this.state.updateTerminalStatus(event.terminalId, event.status);
    this.todos.handleTerminalStatus(event.terminalId, event.status);
    if (['FAILED', 'STOPPED', 'DISCONNECTED'].includes(event.status)) {
      this.agentStartup.cancel(event.terminalId);
      return;
    }
    // RUNNING is emitted once the PTY has actually spawned, which is when waiting for the agent
    // to accept a prompt starts meaning anything.
    if (event.status === 'RUNNING') {
      this.agentStartup.markRuntimeStarted(event.terminalId);
    }
  }

  protected async executeTodoTask(taskId: string): Promise<void> {
    const task = this.todos.task(taskId);
    if (!task || this.busyTodoTaskId()) return;
    const prompt = this.initialTodoPrompt(task);
    const reusableTerminalId =
      task.preferredTerminalId ?? (task.executionState === 'failed' ? task.terminalId : undefined);
    if (reusableTerminalId) {
      const located = this.findTerminal(reusableTerminalId);
      if (!located) {
        if (task.attempts === 0) {
          const message = '选择的已有终端已关闭，请编辑任务后重新选择执行终端。';
          this.todos.setExecutionError(task.id, message);
          this.showToast(message, 'attention');
          return;
        }
      } else if (isReusableTodoTerminal(located.terminal)) {
        await this.runTodoInExistingTerminal(task, prompt, located, task.attempts > 0);
        return;
      } else if (task.attempts === 0) {
        await this.runTodoInExistingTerminal(task, prompt, located);
        return;
      }
    }
    const sessionId = compatibleTodoSessionId(task, this.agents.sessions(), this.agents.events());
    await this.launchTodoTerminal(
      task,
      prompt,
      task.attempts > 0 ? sessionId : undefined,
      task.attempts > 0,
    );
  }

  protected async continueTodoTask(request: TodoContinuationRequest): Promise<void> {
    if (this.busyTodoTaskId()) return;
    const rejected = this.todos.rejectValidation(request);
    if (!rejected) return;

    const prompt = this.continuationTodoPrompt(rejected, request.feedback);
    const located = rejected.terminalId ? this.findTerminal(rejected.terminalId) : null;
    const canReuseTerminal =
      located &&
      located.terminal.agentType === rejected.agentType &&
      !['STOPPED', 'FAILED', 'DISCONNECTED'].includes(located.terminal.status);
    if (located && canReuseTerminal) {
      this.busyTodoTaskId.set(rejected.id);
      try {
        this.todos.beginExecution(
          rejected.id,
          {
            terminalId: located.terminal.id,
            nativeSessionId: rejected.nativeSessionId ?? located.terminal.nativeSessionId,
            accountProfileId: located.terminal.accountProfileId,
          },
          true,
        );
        await this.submitTodoPrompt(rejected.id, located.terminal.id, prompt);
        this.state.updateTerminalStatus(located.terminal.id, 'THINKING');
        this.todos.handleTerminalStatus(located.terminal.id, 'THINKING');
        this.showToast(`已把修改意见发回 ${located.terminal.name}`);
      } catch (error) {
        const message = this.errorMessage(error);
        this.todos.setExecutionError(rejected.id, message, located.terminal.id);
        this.showToast(message, 'attention');
      } finally {
        this.busyTodoTaskId.set(null);
      }
      return;
    }

    const sessionId = compatibleTodoSessionId(
      rejected,
      this.agents.sessions(),
      this.agents.events(),
    );
    await this.launchTodoTerminal(rejected, prompt, sessionId, true);
  }

  /**
   * Stops a running task and interrupts the agent that was working on it.
   *
   * The board state is updated first and synchronously, so a caller that deletes the task right
   * afterwards — "终止并删除" from the card — still hands this the terminal it has to interrupt.
   */
  protected stopTodoTask(taskId: string): void {
    const task = this.todos.task(taskId);
    const terminalId = task?.terminalId;
    if (!this.todos.stopExecution(taskId) || !task) return;
    if (terminalId) {
      this.agentStartup.cancel(terminalId);
      void this.writeToTerminal(terminalId, AGENT_INTERRUPT_SEQUENCE).catch(() => undefined);
    }
    this.showToast(`已终止「${task.title}」，任务已回到待办`);
  }

  protected openTodoTerminal(terminalId: string): void {
    const located = this.findTerminal(terminalId);
    if (!located) {
      this.showToast('关联终端已关闭，可从任务卡片继续执行以恢复会话。', 'attention');
      return;
    }
    if (this.state.activeWorkspace()?.id !== located.workspace.id) {
      this.selectWorkspace(located.workspace.id);
    }
    this.workspaceView.set('terminal');
    window.requestAnimationFrame(() => this.selectTerminal(terminalId));
  }

  /**
   * Closes the terminal an accepted task was running in.
   *
   * The task keeps its native session id, so a 常用任务 that runs again still resumes the same
   * agent session in a fresh terminal.
   */
  protected closeTodoTerminal(terminalId: string): void {
    const located = this.findTerminal(terminalId);
    if (!located) return;
    this.closeTerminal(terminalId);
    this.showToast(`已关闭 ${located.terminal.name}`);
  }

  protected openPromptLibrary(): void {
    this.promptLibraryOpen.set(true);
  }

  protected async usePromptAsset(asset: PromptAsset): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const terminal = this.state.activeTerminal();
    if (!workspace || !terminal || terminal.agentType === 'shell') {
      this.showToast(this.i18n.t('prompt.noAgent'), 'attention');
      return;
    }
    try {
      this.rememberPromptDraft(workspace, terminal, asset.content);
      await this.deliverTerminalPrompt(terminal.id, asset.content, false);
      this.promptLibraryOpen.set(false);
      this.showToast(this.i18n.t('prompt.restored', { name: terminal.name }));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async togglePromptFavorite(asset: PromptAsset): Promise<void> {
    try {
      await this.promptAssets.toggleFavorite(asset);
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async togglePromptPinned(asset: PromptAsset): Promise<void> {
    try {
      await this.promptAssets.togglePinned(asset);
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async deletePromptAsset(asset: PromptAsset): Promise<void> {
    try {
      await this.promptAssets.delete(asset.id);
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected openHandoffCenter(): void {
    const latest = this.activeHandoffRecords()[0];
    if (!this.handoffPreview() && latest) {
      this.selectHandoffRecord(latest);
    }
    this.handoffOpen.set(true);
  }

  protected async generateHandoff(request: HandoffGenerateRequest): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const sourceTerminalId = this.handoffSourceTerminalId() ?? undefined;
    if (!workspace || !sourceTerminalId) {
      this.showToast(this.i18n.t('handoff.noAgent'), 'attention');
      return;
    }
    try {
      const handoff = await this.handoffs.generate(
        workspace,
        request.scope,
        sourceTerminalId,
        request.tokenBudget,
        this.activePromptAssets(),
        this.agents.sessions(),
      );
      this.handoffPreview.set(handoff);
      this.showToast(this.i18n.t('handoff.generated'));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async selectHandoffRecord(record: HandoffRecord): Promise<void> {
    try {
      this.handoffPreview.set(await this.handoffs.packageFromRecord(record));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async deleteHandoffRecord(record: HandoffRecord): Promise<void> {
    try {
      await this.handoffs.delete(record.id);
      if (this.handoffPreview()?.id === record.id) {
        this.handoffPreview.set(null);
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async importHandoff(): Promise<void> {
    try {
      const handoff = await this.handoffs.importPackage();
      if (handoff) {
        this.handoffPreview.set(handoff);
        this.showToast(this.i18n.t('handoff.imported'));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async exportHandoff(event: {
    handoff: HandoffPackage;
    format: 'md' | 'json';
  }): Promise<void> {
    try {
      if (await this.handoffs.exportPackage(event.handoff, event.format)) {
        this.showToast(this.i18n.t('handoff.exported'));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async sendHandoff(request: HandoffSendRequest): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const terminal = workspace?.terminals.find((candidate) => candidate.id === request.terminalId);
    if (!workspace || !terminal || terminal.agentType === 'shell') {
      this.showToast(this.i18n.t('handoff.targetMissing'), 'attention');
      return;
    }
    try {
      const { continuationPrompt } = await import('./core/models/handoff');
      const prompt = continuationPrompt(request.handoff);
      this.rememberPromptDraft(workspace, terminal, prompt);
      await this.deliverTerminalPrompt(terminal.id, prompt, true);
      this.promptAssets.captureInput(workspace, terminal, '\r');
      this.selectTerminal(terminal.id);
      this.handoffOpen.set(false);
      this.showToast(this.i18n.t('handoff.sent', { name: terminal.name }));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  private moveActiveTerminal(direction: -1 | 1): boolean {
    const terminalId = this.activeTerminalId();
    if (!terminalId || !this.state.moveTerminal(terminalId, direction)) {
      return false;
    }
    this.scrollTabIntoView(terminalId, 'smooth');
    return true;
  }

  /** Starts a tab drag, carrying the terminal id for drop targets outside this strip. */
  protected startTabDrag(event: DragEvent, terminalId: string): void {
    this.draggedTerminalId.set(terminalId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', terminalId);
    }
  }

  /** Marks the gap the dragged tab would drop into: before this tab, or after its midpoint. */
  protected trackTabDrag(event: DragEvent, index: number): void {
    if (!this.draggedTerminalId()) {
      return;
    }
    // Without this the drop is refused and no drop event ever fires.
    event.preventDefault();
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const pastMidpoint = event.clientX > bounds.left + bounds.width / 2;
    this.tabDropIndex.set(pastMidpoint ? index + 1 : index);
  }

  protected dropTab(event: DragEvent): void {
    const terminalId = this.draggedTerminalId();
    const gapIndex = this.tabDropIndex();
    this.endTabDrag();
    if (!terminalId || gapIndex === null) {
      return;
    }
    event.preventDefault();
    const terminals = this.state.activeWorkspace()?.terminals ?? [];
    const currentIndex = terminals.findIndex((terminal) => terminal.id === terminalId);
    // Gaps are counted with the dragged tab still in place, so every gap past it sits one
    // position further right than the index the tab ends up at once it is lifted out.
    this.state.reorderTerminal(terminalId, gapIndex > currentIndex ? gapIndex - 1 : gapIndex);
  }

  protected endTabDrag(): void {
    this.draggedTerminalId.set(null);
    this.tabDropIndex.set(null);
  }

  /**
   * Scrolls the tab strip with an ordinary wheel.
   *
   * A trackpad or mouse only produces `deltaY` here, which a horizontal strip would ignore, so a
   * vertical wheel is redirected sideways. Shift+wheel already scrolls horizontally on its own.
   */
  protected scrollTabStrip(event: WheelEvent): void {
    const strip = event.currentTarget as HTMLElement;
    if (event.shiftKey || event.deltaY === 0 || strip.scrollWidth <= strip.clientWidth) {
      return;
    }
    event.preventDefault();
    strip.scrollLeft += event.deltaY;
  }

  /** Closes a terminal on a middle click, as browsers and editors do for their own tabs. */
  protected closeTerminalOnMiddleClick(event: MouseEvent, terminalId: string): void {
    if (event.button !== MIDDLE_MOUSE_BUTTON) {
      return;
    }
    event.preventDefault();
    this.closeTerminal(terminalId);
  }

  /** Everything a tab cannot show at its width: where it runs, and what it responds to. */
  protected terminalTabTitle(terminal: TerminalSession): string {
    const action = this.isTerminalVisible(terminal.id)
      ? this.i18n.t('terminal.activate')
      : this.i18n.t('terminal.showInLayout');
    return [
      `${terminal.name} · ${this.statusLabel(terminal.status)}`,
      terminal.workingDirectory,
      `${action} · ${this.i18n.t('terminal.tabHint')}`,
    ].join('\n');
  }

  protected isTerminalVisible(terminalId: string): boolean {
    return this.visibleTerminalIds().includes(terminalId);
  }

  private scrollTabIntoView(terminalId: string, behavior: ScrollBehavior = 'auto'): void {
    window.requestAnimationFrame(() => {
      document
        .getElementById(`terminal-tab-${terminalId}`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
    });
  }

  protected visibleTerminalLimit(): number {
    return this.terminalMaximized()
      ? 1
      : layoutTerminalCapacity(
          this.state.activeWorkspace()?.layout ?? 'single',
          this.gridColumns(),
          this.gridRows(),
        );
  }

  protected toggleTerminalMaximize(terminalId: string): void {
    const shouldRestore = this.terminalMaximized() && this.activeTerminalId() === terminalId;
    this.selectTerminal(terminalId);
    this.terminalMaximized.set(!shouldRestore);
    this.requestTerminalRefit();
  }

  protected toggleWorkspaceMaximize(): void {
    this.workspaceMaximized.update((maximized) => !maximized);
    this.requestTerminalRefit();
  }

  protected toggleWorkspaceSidebar(): void {
    this.workspaceSidebarOpen.update((open) => {
      const next = !open;
      this.storePreference('termexo.workspaceSidebarOpen', next);
      return next;
    });
  }

  protected toggleInspector(): void {
    this.inspectorOpen.update((open) => {
      const next = !open;
      this.storePreference('termexo.inspectorOpen', next);
      return next;
    });
  }

  protected startSidebarResize(target: SidebarResizeTarget, event: PointerEvent): void {
    if (event.button !== 0 || this.workspaceMaximized()) {
      return;
    }
    event.preventDefault();
    this.resizeStartX = event.clientX;
    this.resizeStartWidth =
      target === 'workspace' ? this.workspaceSidebarWidth() : this.inspectorWidth();
    this.resizingSidebar.set(target);
  }

  @HostListener('window:pointermove', ['$event'])
  protected resizeSidebar(event: PointerEvent): void {
    const target = this.resizingSidebar();
    if (!target) {
      return;
    }
    const delta = event.clientX - this.resizeStartX;
    if (target === 'workspace') {
      this.workspaceSidebarWidth.set(
        Math.min(
          WORKSPACE_SIDEBAR_MAX_WIDTH,
          Math.max(WORKSPACE_SIDEBAR_MIN_WIDTH, this.resizeStartWidth + delta),
        ),
      );
    } else {
      this.inspectorWidth.set(
        Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, this.resizeStartWidth - delta)),
      );
    }
  }

  @HostListener('window:pointerup')
  protected stopSidebarResize(): void {
    const target = this.resizingSidebar();
    if (!target) {
      return;
    }
    this.storePreference(
      target === 'workspace' ? 'termexo.workspaceSidebarWidth' : 'termexo.inspectorWidth',
      target === 'workspace' ? this.workspaceSidebarWidth() : this.inspectorWidth(),
    );
    this.resizingSidebar.set(null);
  }

  @HostListener('window:resize')
  protected adaptLayoutToViewport(): void {
    const width = window.innerWidth;
    if (
      this.previousViewportWidth >= INSPECTOR_AUTO_COLLAPSE_WIDTH &&
      width < INSPECTOR_AUTO_COLLAPSE_WIDTH
    ) {
      this.inspectorOpen.set(false);
    }
    if (
      this.previousViewportWidth >= WORKSPACE_SIDEBAR_AUTO_COLLAPSE_WIDTH &&
      width < WORKSPACE_SIDEBAR_AUTO_COLLAPSE_WIDTH
    ) {
      this.workspaceSidebarOpen.set(false);
    }
    this.previousViewportWidth = width;
    this.requestTerminalRefit();
  }

  private requestTerminalRefit(): void {
    this.layoutRevision.update((revision) => revision + 1);
  }

  /**
   * Closes the agent menu when the click lands outside it.
   *
   * Registered on the document rather than a backdrop element so the menu also closes when the
   * click goes to a terminal, which has no overlay to catch it.
   */
  @HostListener('document:pointerdown', ['$event'])
  protected closeAgentMenuOnOutsideClick(event: PointerEvent): void {
    if (!this.agentMenuOpen()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.menu-anchor')) {
      this.agentMenuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected closeAgentMenuOnEscape(): void {
    this.agentMenuOpen.set(false);
  }

  /**
   * The single entry point for window-level keys.
   *
   * Bound to the window because the focused terminal is where these keys land; the panel declines
   * the tab shortcuts so they arrive here instead of being written to the PTY. Angular runs one
   * handler per host event, so a second `window:keydown` binding on this component would never
   * fire — every window shortcut has to be dispatched from here.
   */
  @HostListener('window:keydown', ['$event'])
  protected handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.restoreMaximizedView(event);
      return;
    }
    this.runTabShortcut(event);
  }

  private runTabShortcut(event: KeyboardEvent): void {
    const shortcut = workbenchShortcut(event);
    const terminals = this.state.activeWorkspace()?.terminals ?? [];
    if (!shortcut || this.workspaceView() !== 'terminal' || terminals.length === 0) {
      return;
    }
    // An open dialog owns the keyboard; the strip behind it must not react to keys typed into it.
    const target = event.target;
    if (target instanceof Element && target.closest('[role="dialog"]')) {
      return;
    }

    if (shortcut.action === 'moveTab') {
      if (this.moveActiveTerminal(shortcut.delta)) {
        event.preventDefault();
      }
      return;
    }

    const activeIndex = terminals.findIndex((terminal) => terminal.id === this.activeTerminalId());
    const terminal =
      shortcut.action === 'selectTab'
        ? terminals[shortcut.index]
        : terminals[(activeIndex + shortcut.delta + terminals.length) % terminals.length];
    if (terminal) {
      event.preventDefault();
      this.selectTerminal(terminal.id);
    }
  }

  private restoreMaximizedView(event: KeyboardEvent): void {
    if (!event.shiftKey) {
      return;
    }
    if (this.terminalMaximized()) {
      event.preventDefault();
      this.terminalMaximized.set(false);
      return;
    }
    if (this.workspaceMaximized()) {
      event.preventDefault();
      this.workspaceMaximized.set(false);
    }
  }

  protected changeLayout(layout: LayoutMode): void {
    this.state.setLayout(layout);
  }

  protected adjustGridDimension(axis: 'columns' | 'rows', delta: -1 | 1): void {
    const value = (axis === 'columns' ? this.gridColumns() : this.gridRows()) + delta;
    this.state.setGridDimensions(
      axis === 'columns' ? normalizeTerminalGridDimension(value) : this.gridColumns(),
      axis === 'rows' ? normalizeTerminalGridDimension(value) : this.gridRows(),
    );
  }

  protected swapGridDimensions(): void {
    this.state.setGridDimensions(this.gridRows(), this.gridColumns());
  }

  protected adjustTerminalFontSize(delta: -1 | 1): void {
    const next = normalizeTerminalFontSize(this.terminalFontSize() + delta);
    this.terminalFontSize.set(next);
    this.storePreference('termexo.terminalFontSize', next);
  }

  /**
   * Applies a family chosen from the picker.
   *
   * The picker only lists installed families, so the availability check is a guard against a
   * font uninstalled since the list was cached rather than against a typo.
   */
  protected selectTerminalFont(name: string): void {
    const next = normalizeTerminalFontName(name);
    if (!isTerminalFontAvailable(next)) {
      this.showToast(this.i18n.t('terminal.fontUnavailable', { name: next }), 'attention');
      return;
    }
    this.terminalFontName.set(next);
    this.storePreference(TERMINAL_FONT_NAME_STORAGE_KEY, next);
  }

  private availableTerminalFontName(value: string): string {
    const normalized = normalizeTerminalFontName(value);
    return isTerminalFontAvailable(normalized) ? normalized : DEFAULT_TERMINAL_FONT_NAME;
  }

  protected createWorkspace(value: { name: string; projectPath: string }): void {
    this.state.createWorkspace(value.name, value.projectPath);
    const workspace = this.state.activeWorkspace();
    if (workspace) this.todos.ensureWorkspace(workspace);
    this.mountWorkspace(this.state.activeWorkspace()?.id);
    this.createWorkspaceOpen.set(false);
    this.showToast(this.i18n.t('workspace.created', { name: value.name }));
  }

  protected openWorkspaceDelete(workspaceId: string): void {
    const workspace = this.state.workspaces().find((item) => item.id === workspaceId);
    if (workspace) {
      this.workspacePendingDeletion.set(workspace);
    }
  }

  protected closeWorkspaceDelete(): void {
    if (!this.deletingWorkspace()) {
      this.workspacePendingDeletion.set(null);
    }
  }

  protected async confirmWorkspaceDelete(): Promise<void> {
    const workspace = this.workspacePendingDeletion();
    if (!workspace || this.deletingWorkspace()) {
      return;
    }

    this.deletingWorkspace.set(true);
    try {
      const removed = await this.state.deleteWorkspace(workspace.id);
      if (!removed) {
        throw new Error(this.i18n.t('workspace.notFound'));
      }
      // Persist removal before killing PTYs: their exit events update terminal status and used to
      // race the delete by saving the just-removed workspace back into SQLite.
      void Promise.all(
        workspace.terminals.map((terminal) =>
          this.terminalGateway.close(terminal.id).catch(() => undefined),
        ),
      );
      this.mountedWorkspaceIds.update((workspaceIds) =>
        workspaceIds.filter((workspaceId) => workspaceId !== workspace.id),
      );
      this.todos.deleteWorkspace(workspace.id);
      this.mountWorkspace(this.state.activeWorkspace()?.id);
      this.preferredTerminalIds.update((items) => {
        const next = { ...items };
        delete next[workspace.id];
        return next;
      });
      this.terminalMaximized.set(false);
      this.workspacePendingDeletion.set(null);
      this.showToast(this.i18n.t('workspace.deleted', { name: workspace.name }));
    } catch (error) {
      this.showToast(
        this.i18n.t('workspace.deleteFailed', { error: this.errorMessage(error) }),
        'attention',
      );
    } finally {
      this.deletingWorkspace.set(false);
    }
  }

  protected openWorkspaceMerge(workspaceId: string): void {
    const workspace = this.state.workspaces().find((item) => item.id === workspaceId);
    if (workspace && this.state.workspaces().length > 1) {
      this.workspacePendingMerge.set(workspace);
    }
  }

  protected closeWorkspaceMerge(): void {
    if (!this.mergingWorkspace()) {
      this.workspacePendingMerge.set(null);
    }
  }

  protected async confirmWorkspaceMerge(targetWorkspaceId: string): Promise<void> {
    const sourceWorkspace = this.workspacePendingMerge();
    if (!sourceWorkspace || this.mergingWorkspace()) {
      return;
    }

    const targetWorkspace = this.state
      .workspaces()
      .find((workspace) => workspace.id === targetWorkspaceId);
    if (!targetWorkspace) {
      this.showToast(this.i18n.t('workspace.mergeTargetNotFound'), 'attention');
      return;
    }

    this.mergingWorkspace.set(true);
    try {
      const mergedWorkspace = await this.state.mergeWorkspaces(
        sourceWorkspace.id,
        targetWorkspaceId,
      );
      if (!mergedWorkspace) {
        throw new Error(this.i18n.t('workspace.mergeEndpointsNotFound'));
      }

      this.todos.mergeWorkspaces(sourceWorkspace.id, mergedWorkspace);

      this.mountedWorkspaceIds.update((workspaceIds) =>
        workspaceIds.filter((workspaceId) => workspaceId !== sourceWorkspace.id),
      );
      this.mountWorkspace(mergedWorkspace.id);
      this.preferredTerminalIds.update((items) => {
        const terminalIds = new Set(mergedWorkspace.terminals.map((terminal) => terminal.id));
        const preferredIds = [
          ...(items[targetWorkspaceId] ?? []),
          ...(items[sourceWorkspace.id] ?? []),
          ...mergedWorkspace.terminals.map((terminal) => terminal.id),
        ].filter(
          (terminalId, index, values) =>
            terminalIds.has(terminalId) && values.indexOf(terminalId) === index,
        );
        const next = { ...items, [targetWorkspaceId]: preferredIds };
        delete next[sourceWorkspace.id];
        return next;
      });
      this.terminalMaximized.set(false);
      this.workspacePendingMerge.set(null);
      this.showToast(
        this.i18n.t('workspace.merged', {
          source: sourceWorkspace.name,
          target: targetWorkspace.name,
        }),
      );
    } catch (error) {
      this.showToast(
        this.i18n.t('workspace.mergeFailed', { error: this.errorMessage(error) }),
        'attention',
      );
    } finally {
      this.mergingWorkspace.set(false);
    }
  }

  protected openWorkspaceEditor(workspaceId: string): void {
    this.editingWorkspaceId.set(workspaceId);
  }

  protected selectWorkspace(workspaceId: string): void {
    this.globalNoticeOpen.set(false);
    this.mountWorkspace(workspaceId);
    this.state.selectWorkspace(workspaceId);
    const workspace = this.state.activeWorkspace();
    if (workspace) this.todos.ensureWorkspace(workspace);
  }

  protected openGlobalTerminalNotice(notice: GlobalTerminalNotice): void {
    this.selectWorkspace(notice.workspaceId);
    window.requestAnimationFrame(() => this.selectTerminal(notice.terminalId));
  }

  protected openAttentionBanner(): void {
    const banner = this.attentionBanner();
    if (!banner) {
      return;
    }

    this.dismissNoticeKeys([globalNoticeKey(banner.target)]);
    this.openGlobalTerminalNotice(banner.target);
  }

  /**
   * Clears one terminal's notice by returning it to a status that no longer asks for attention.
   *
   * Each agent event is applied once, so a cleared status stays cleared until the agent reports
   * something new — which is what makes this useful for a notice the user has already handled in
   * the terminal itself.
   */
  protected clearTerminalNotice(notice: GlobalTerminalNotice): void {
    this.state.updateTerminalStatus(notice.terminalId, clearedNoticeStatus(notice.status));
  }

  /** Clears every notice at once, for a batch that has already been dealt with. */
  protected clearAllTerminalNotices(): void {
    for (const notice of this.globalTerminalNotices()) {
      this.clearTerminalNotice(notice);
    }
    this.globalNoticeOpen.set(false);
  }

  protected dismissAttentionBanner(): void {
    this.dismissNoticeKeys(
      this.globalTerminalNotices().filter(isWaitingNotice).map(globalNoticeKey),
    );
  }

  private dismissNoticeKeys(keys: readonly string[]): void {
    this.dismissedNoticeKeys.update((dismissed) => new Set([...dismissed, ...keys]));
  }

  /**
   * Drops dismissals whose terminal already left the waiting state, so the same terminal
   * blocking again raises a fresh banner instead of staying silently hidden.
   */
  private forgetResolvedDismissals(currentKeys: ReadonlySet<string>): void {
    const dismissed = untracked(this.dismissedNoticeKeys);
    const retained = [...dismissed].filter((key) => currentKeys.has(key));
    if (retained.length !== dismissed.size) {
      this.dismissedNoticeKeys.set(new Set(retained));
    }
  }

  /** Manual check from the settings panel, which reports both outcomes as a toast. */
  protected async checkForUpdate(): Promise<void> {
    try {
      const result = await this.updates.check();
      if (!result) {
        return;
      }
      this.showToast(
        result.updateAvailable
          ? this.i18n.t('update.available', { version: result.latestVersion })
          : this.i18n.t('update.upToDate'),
        result.updateAvailable ? 'attention' : 'success',
      );
    } catch (error) {
      this.showToast(`${this.i18n.t('update.failed')}: ${this.errorMessage(error)}`, 'attention');
    }
  }

  /**
   * Installs the newest npm build. The app closes so npm can overwrite the executable Windows
   * currently has locked, then the new build starts on its own.
   */
  protected async installUpdateViaNpm(): Promise<void> {
    if (this.updateInstalling()) {
      return;
    }
    this.updateInstalling.set(true);
    this.showToast(this.i18n.t('update.installStarting'), 'attention');
    try {
      await this.updates.updateViaNpm();
    } catch (error) {
      this.updateInstalling.set(false);
      this.showToast(
        `${this.i18n.t('update.installFailed')}: ${this.errorMessage(error)}`,
        'attention',
      );
    }
  }

  protected async openReleasePage(): Promise<void> {
    try {
      await this.updates.openReleasePage();
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected saveWorkspaceAppearance(value: WorkspaceAppearanceValue): void {
    if (this.state.updateWorkspaceAppearance(value.workspaceId, value.name, value.themeColor)) {
      this.editingWorkspaceId.set(null);
      this.showToast(this.i18n.t('workspace.updated', { name: value.name }));
    }
  }

  /** Opens the switcher scoped to one terminal, preselecting its agent type. */
  protected openSingleModelSwitch(terminalId: string): void {
    const terminal = this.state.activeWorkspace()?.terminals.find((item) => item.id === terminalId);
    if (!terminal || terminal.agentType === 'shell' || terminal.agentType === 'opencode') {
      return;
    }
    this.modelSwitchTerminalId.set(terminalId);
    this.modelSwitchAgentType.set(terminal.agentType);
    this.modelSwitchOpen.set(true);
  }

  /** Closes the switcher and clears its scope, so the next open starts as a batch switch. */
  protected closeModelSwitch(): void {
    this.modelSwitchOpen.set(false);
    this.modelSwitchTerminalId.set(null);
    this.modelSwitchAgentType.set(null);
  }

  /** Opens the switcher for every terminal of the chosen agent type. */
  protected openBatchModelSwitch(): void {
    this.modelSwitchTerminalId.set(null);
    this.modelSwitchAgentType.set(null);
    this.modelSwitchOpen.set(true);
  }

  protected async switchModels(value: ModelSwitchValue): Promise<void> {
    const isClaude = value.agent === 'claude';
    if (isClaude ? this.launchingClaude() : this.launchingCodex()) {
      return;
    }

    const workspace = this.state.activeWorkspace();
    const profile = this.agents.modelProfiles().find((item) => item.id === value.profileId);
    const agentType = isClaude ? 'claude' : 'codex';
    // A single-terminal switch reuses this whole flow, narrowed to one target.
    const targetId = this.modelSwitchTerminalId();
    const terminals = (workspace?.terminals ?? []).filter(
      (terminal) =>
        terminal.agentType === agentType && (targetId === null || terminal.id === targetId),
    );
    if (!profile || terminals.length === 0) {
      this.closeModelSwitch();
      this.showToast(
        this.i18n.t(
          profile
            ? isClaude
              ? 'profile.noClaudeTerminals'
              : 'profile.noCodexTerminals'
            : 'profile.notFound',
        ),
      );
      return;
    }
    if (needsCredential(profile, isClaude ? 'claude' : 'codex')) {
      this.openModelCredentialSettings(profile.id, profile.name);
      return;
    }
    // The dialog disables the current profile; this guard also prevents a stale or scripted event
    // from needlessly closing and restarting the same single terminal.
    if (targetId !== null && terminals.length === 1 && terminals[0].profileId === profile.id) {
      this.closeModelSwitch();
      return;
    }

    (isClaude ? this.launchingClaude : this.launchingCodex).set(true);
    try {
      // Build every launch command before touching a PTY. A missing credential or incompatible
      // profile therefore aborts the whole plan with every existing session still running.
      const plans = await Promise.all(
        terminals.map(async (terminal) => ({
          original: { ...terminal },
          launch: isClaude
            ? await this.agents.prepareLaunch({
                terminalId: terminal.id,
                workspaceId: workspace?.id,
                profileId: value.profileId,
                mcpProfileId: terminal.mcpProfileId,
                accountProfileId: terminal.accountProfileId,
                autoConfirm: terminal.autoConfirm,
              })
            : await this.agents.prepareCodexLaunch({
                terminalId: terminal.id,
                workspaceId: workspace?.id,
                profileId: value.profileId,
                accountProfileId: terminal.accountProfileId,
                autoConfirm: terminal.autoConfirm,
              }),
        })),
      );
      const switched: typeof plans = [];
      let failure: unknown = null;
      for (const plan of plans) {
        try {
          await this.terminalGateway.close(plan.original.id);
          if (
            !this.state.restartTerminalWithProfile(
              plan.original.id,
              plan.launch.command,
              profileModel(profile, value.agent),
              value.profileId,
              isClaude ? plan.original.mcpProfileId : undefined,
            )
          ) {
            throw new Error(
              this.i18n.t('restore.terminalMissing', {
                agent: isClaude ? 'Claude' : 'Codex',
                name: plan.original.name,
              }),
            );
          }
          switched.push(plan);
        } catch (error) {
          failure = error;
          break;
        }
      }

      let rollbackFailures = 0;
      if (failure) {
        // Include the failed target: its PTY may already have closed before the state update failed.
        const rollbackTargets = plans.slice(0, Math.min(switched.length + 1, plans.length));
        for (const plan of rollbackTargets.reverse()) {
          try {
            await this.terminalGateway.close(plan.original.id).catch(() => undefined);
            if (
              !plan.original.command ||
              !this.state.restartTerminalWithProfile(
                plan.original.id,
                plan.original.command,
                plan.original.model,
                plan.original.profileId,
                plan.original.mcpProfileId,
              )
            ) {
              rollbackFailures += 1;
            }
          } catch {
            rollbackFailures += 1;
          }
        }
      }
      this.closeModelSwitch();
      this.showToast(
        failure
          ? this.i18n.t('profile.switchPartial', {
              switched: 0,
              failed: terminals.length,
              error: `${this.errorMessage(failure)} · ${
                rollbackFailures === 0
                  ? this.i18n.t('profile.rollbackComplete')
                  : this.i18n.t('profile.rollbackPartial', { count: rollbackFailures })
              }`,
            })
          : this.i18n.t(isClaude ? 'profile.switched' : 'profile.switchedCodex', {
              count: switched.length,
              name: profile.name,
            }),
        failure ? 'attention' : 'success',
      );
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    } finally {
      (isClaude ? this.launchingClaude : this.launchingCodex).set(false);
    }
  }

  protected async saveModelProfile(input: ModelProfileInput): Promise<void> {
    try {
      await this.agents.saveModelProfile(input);
      this.showToast(this.i18n.t('profile.saved'));
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected openSettings(tab: SettingsTab = 'diagnostics', modelProfileId = ''): void {
    this.settingsInitialTab.set(tab);
    this.settingsInitialModelProfileId.set(modelProfileId);
    this.settingsOpen.set(true);
  }

  protected async saveAccountProfile(input: AccountProfileInput): Promise<void> {
    try {
      await this.agents.saveAccountProfile(input);
      this.showToast(this.i18n.t('account.saved'));
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteAccountProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteAccountProfile(profileId);
      this.showToast(this.i18n.t('account.removed'));
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async refreshAccountProfile(profileId: string): Promise<void> {
    try {
      await this.agents.refreshAccountProfile(profileId);
      const profile = this.agents.accountProfiles().find((item) => item.id === profileId);
      this.showToast(profile?.diagnostic ?? this.i18n.t('account.refreshed'));
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async loginAccount(profileId: string): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const profile = this.agents.accountProfiles().find((item) => item.id === profileId);
    if (!workspace || !profile) {
      return;
    }
    const workingDirectory = await this.selectTerminalDirectory();
    if (!workingDirectory) {
      return;
    }
    const terminalId = crypto.randomUUID();
    try {
      const launch = await this.agents.prepareAccountLogin({
        terminalId,
        workspaceId: workspace.id,
        accountProfileId: profileId,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: profile.agentType,
        name: this.i18n.t('account.loginName', { name: profile.name }),
        command: launch.command,
        model: this.i18n.t('account.loginModel'),
        workingDirectory,
      });
      this.settingsOpen.set(false);
      if (terminal) {
        this.showToast(this.i18n.t('account.loginOpened', { name: profile.name }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteModelProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteModelProfile(profileId);
      this.showToast(this.i18n.t('profile.deleted'));
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async saveMcpProfile(input: McpProfileInput): Promise<void> {
    try {
      await this.agents.saveMcpProfile(input);
      this.showToast(this.i18n.t('mcp.saved'));
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteMcpProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteMcpProfile(profileId);
      this.showToast(this.i18n.t('mcp.deleted'));
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async saveNetworkProfile(input: NetworkProfileInput): Promise<void> {
    try {
      await this.agents.saveNetworkProfile(input);
      this.networkTestResult.set(null);
      this.showToast(this.i18n.t('network.saved'));
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteNetworkProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteNetworkProfile(profileId);
      this.networkTestResult.set(null);
      this.showToast(this.i18n.t('network.deleted'));
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async testNetworkProfile(profileId: string): Promise<void> {
    this.networkTestResult.set(null);
    try {
      const result = await this.agents.testNetworkProfile(profileId);
      this.networkTestResult.set(result);
      this.showToast(result.message);
    } catch (error) {
      const message = this.errorMessage(error);
      this.networkTestResult.set({
        profileId,
        healthy: false,
        target: 'connection',
        message,
        latencyMs: 0,
      });
      this.showToast(message);
    }
  }

  protected async importSystemProxy(): Promise<void> {
    try {
      const discovered = await this.agents.discoverSystemProxy();
      await this.agents.saveNetworkProfile({
        id: crypto.randomUUID(),
        name: this.i18n.t('settings.importedSystemProxy'),
        scope: 'global',
        enabled: true,
        isDefault: false,
        httpProxy: discovered.httpProxy,
        httpsProxy: discovered.httpsProxy,
        allProxy: discovered.allProxy,
        noProxy: discovered.noProxy,
        npmStrictSsl: true,
      });
      this.showToast(discovered.diagnostic);
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  /** Exports every proxy profile to a file the user picks. Passwords are never written. */
  protected async exportNetworkProfiles(): Promise<void> {
    try {
      const result = await this.agents.exportNetworkProfiles();
      if (!result) {
        return;
      }
      this.showToast(this.i18n.t('settings.exportProxyDone', result));
    } catch (error) {
      this.showToast(
        `${this.i18n.t('settings.exportProxyFailed')}: ${this.errorMessage(error)}`,
        'attention',
      );
    }
  }

  /**
   * Imports proxy profiles from an exported file.
   *
   * The toast names how many arrived and which ones still need a password, because the file
   * never carries credentials and those profiles will not authenticate until one is entered.
   */
  protected async importNetworkProfiles(): Promise<void> {
    try {
      const summary = await this.agents.importNetworkProfiles();
      if (!summary) {
        return;
      }
      const parts = [this.i18n.t('settings.importProxyDone', { count: summary.imported })];
      if (summary.needsPassword.length > 0) {
        parts.push(
          this.i18n.t('settings.importProxyNeedsPassword', {
            names: summary.needsPassword.join('、'),
          }),
        );
      }
      if (summary.skipped.length > 0) {
        parts.push(this.i18n.t('settings.importProxySkipped', { count: summary.skipped.length }));
      }
      this.showToast(parts.join(' '), summary.skipped.length > 0 ? 'attention' : 'success');
    } catch (error) {
      this.showToast(
        `${this.i18n.t('settings.importProxyFailed')}: ${this.errorMessage(error)}`,
        'attention',
      );
    }
  }

  protected async previewCliOperation(request: CliOperationRequest): Promise<void> {
    this.cliOperationPlan.set(null);
    this.cliOperationResult.set(null);
    try {
      const plan = await this.agents.previewCliOperation(request);
      this.cliOperationPlan.set(plan);
      this.showToast(plan.diagnostic);
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async detectAgentInstallations(): Promise<void> {
    await Promise.all([
      this.agents.detectClaude(),
      this.agents.detectCodex(),
      this.agents.detectOpenCode(),
    ]);
    this.showToast(this.i18n.t('agent.detectionComplete'));
  }

  protected async executeCliOperation(request: CliOperationRequest): Promise<void> {
    this.cliOperationResult.set(null);
    try {
      const result = await this.agents.executeCliOperation(request);
      this.cliOperationPlan.set(result.plan);
      this.cliOperationResult.set(result);
      this.showToast(result.diagnostic);
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  private showToast(message: string, tone: 'success' | 'attention' = 'success'): void {
    this.toastTone.set(tone);
    this.toastMessage.set(message);
    window.setTimeout(() => {
      if (this.toastMessage() === message) {
        this.toastMessage.set(null);
      }
    }, 2_400);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private findTerminal(
    terminalId: string,
  ): { workspace: Workspace; terminal: TerminalSession } | null {
    for (const workspace of this.state.workspaces()) {
      const terminal = workspace.terminals.find((candidate) => candidate.id === terminalId);
      if (terminal) {
        return { workspace, terminal };
      }
    }
    return null;
  }

  private async launchTodoTerminal(
    task: TodoTask,
    prompt: string,
    sessionId?: string,
    continuation = false,
  ): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const project = this.todos.project(task.projectId);
    const workingDirectory = todoWorkingDirectory(task, project);
    const profile = this.agents.modelProfiles().find((item) => item.id === task.profileId);
    if (!workspace || workspace.id !== task.workspaceId || !workingDirectory) {
      this.todos.setExecutionError(task.id, '任务缺少可用的工作目录，请先在待办中选择目录。');
      this.showToast('任务缺少可用的工作目录，请先在待办中选择目录。', 'attention');
      return;
    }
    if (!profile) {
      this.todos.setExecutionError(task.id, '模型配置已不存在，请编辑待办后重新选择模型。');
      this.showToast('模型配置已不存在，请编辑待办后重新选择模型。', 'attention');
      return;
    }
    if (needsCredential(profile, task.agentType)) {
      this.openModelCredentialSettings(profile.id, profile.name);
      this.todos.setExecutionError(task.id, `模型配置 ${profile.name} 缺少凭据。`);
      return;
    }

    // A task carries no account of its own until it has resumed a native session, while the
    // backend silently falls back to the agent's default account. Resolving it here keeps the
    // terminal record honest about the subscription it spends, which is what the inspector
    // matches provider allowances against.
    const accountProfileId = resolveAccountProfileId(
      this.agents.accountProfiles(),
      task.agentType,
      task.accountProfileId,
    );

    this.busyTodoTaskId.set(task.id);
    const terminalId = crypto.randomUUID();
    try {
      await this.assertTodoAgentAvailable(task.agentType);
      const reclaim: BackgroundReclaim =
        task.agentType === 'codex'
          ? { proceed: true, forkSession: false }
          : await this.reclaimBackgroundSession(sessionId);
      if (!reclaim.proceed) {
        return;
      }
      const launch =
        task.agentType === 'codex'
          ? await this.agents.prepareCodexLaunch({
              terminalId,
              workspaceId: workspace.id,
              sessionId,
              model: profileModel(profile, 'codex'),
              profileId: profile.id,
              accountProfileId,
            })
          : await this.agents.prepareLaunch({
              terminalId,
              workspaceId: workspace.id,
              sessionId,
              profileId: profile.id,
              accountProfileId,
              forkSession: reclaim.forkSession,
              attachShortId: reclaim.attachShortId,
            });
      const terminal = this.state.createTerminal(
        {
          id: terminalId,
          agentType: task.agentType,
          name: `任务 · ${task.title}`,
          command: launch.command,
          model: profileModel(profile, task.agentType),
          nativeSessionId: sessionId,
          workingDirectory,
          profileId: profile.id,
          accountProfileId,
        },
        workspace.id,
      );
      if (!terminal) {
        throw new Error('任务所属工作空间已关闭，无法创建任务终端。');
      }
      const started = this.todos.beginExecution(
        task.id,
        { terminalId, nativeSessionId: sessionId, accountProfileId },
        continuation,
      );
      if (!started) {
        throw new Error('任务已不存在，已取消终端投递。');
      }
      this.armTodoPrompt(terminalId, task.id, prompt);
      this.mountWorkspace(workspace.id);
      this.showToast(
        sessionId
          ? `终端已创建，正在恢复会话，Agent 就绪后自动发送：${task.title}`
          : `终端已创建，Agent 就绪后自动发送任务到 ${terminal.name}`,
      );
    } catch (error) {
      this.agentStartup.cancel(terminalId);
      const message = this.errorMessage(error);
      this.todos.setExecutionError(task.id, message);
      this.showToast(message, 'attention');
    } finally {
      this.busyTodoTaskId.set(null);
    }
  }

  private async runTodoInExistingTerminal(
    task: TodoTask,
    prompt: string,
    located: { workspace: Workspace; terminal: TerminalSession },
    continuation = false,
  ): Promise<void> {
    const terminal = located.terminal;
    const terminalIsOccupied = this.todos
      .tasksFor(located.workspace.id)
      .some(
        (candidate) =>
          candidate.id !== task.id &&
          candidate.stage === 'executing' &&
          candidate.terminalId === terminal.id,
      );
    let unavailableReason = '';
    if (located.workspace.id !== task.workspaceId) {
      unavailableReason = '选择的已有终端不在当前任务的工作空间。';
    } else if (!isReusableTodoTerminal(terminal)) {
      unavailableReason = '选择的已有终端尚未就绪或已不可用，请重新选择。';
    } else if (this.agentStartup.awaitingTerminalIds().includes(terminal.id)) {
      unavailableReason = '选择的已有终端仍在启动，请稍后重试。';
    } else if (terminal.agentType !== task.agentType) {
      unavailableReason = '已有终端的 Agent 类型与任务配置不一致，请编辑待办后重新选择。';
    } else if (terminalIsOccupied) {
      unavailableReason = '选择的已有终端正在执行另一项看板任务。';
    }
    if (unavailableReason) {
      this.todos.setExecutionError(task.id, unavailableReason);
      this.showToast(unavailableReason, 'attention');
      return;
    }

    this.busyTodoTaskId.set(task.id);
    try {
      this.todos.beginExecution(
        task.id,
        {
          terminalId: terminal.id,
          nativeSessionId: terminal.nativeSessionId,
          accountProfileId: terminal.accountProfileId,
        },
        continuation,
      );
      await this.submitTodoPrompt(task.id, terminal.id, prompt);
      this.state.updateTerminalStatus(terminal.id, 'THINKING');
      this.todos.handleTerminalStatus(terminal.id, 'THINKING');
      this.showToast(`已把任务发送到 ${terminal.name}`);
    } catch (error) {
      const message = this.errorMessage(error);
      this.todos.setExecutionError(task.id, message, terminal.id);
      this.showToast(message, 'attention');
    } finally {
      this.busyTodoTaskId.set(null);
    }
  }

  private async assertTodoAgentAvailable(agentType: TodoTask['agentType']): Promise<void> {
    if (!isTauriRuntime()) return;
    if (agentType === 'claude') {
      if (!this.agents.installation()) await this.agents.detectClaude();
      const installation = this.agents.installation();
      if (!installation?.healthy) {
        throw new Error(installation?.diagnostic ?? '未检测到可用的 Claude Code。');
      }
      return;
    }
    if (!this.agents.codexInstallation()) await this.agents.detectCodex();
    const installation = this.agents.codexInstallation();
    if (!installation?.healthy) {
      throw new Error(installation?.diagnostic ?? '未检测到可用的 Codex CLI。');
    }
  }

  /**
   * Claude Code and Codex CLI both open on a folder-trust dialog, so the prompt has to wait until
   * the startup dialogs are answered and the agent's input is actually listening.
   */
  private armTodoPrompt(terminalId: string, taskId: string, prompt: string): void {
    this.agentStartup.arm(terminalId, {
      confirm: () => this.writeToTerminal(terminalId, AGENT_STARTUP_CONFIRM_KEY),
      submit: () => this.submitTodoPrompt(taskId, terminalId, prompt),
      onFailed: (message) => {
        this.todos.setExecutionError(taskId, message, terminalId);
        this.showToast(`任务发送失败：${message}`, 'attention');
      },
    });
    // The PTY is normally still spawning here, and its RUNNING event starts the clocks. A terminal
    // that already reported RUNNING has sent that event before this armed, and would wait forever.
    if (this.findTerminal(terminalId)?.terminal.status === 'RUNNING') {
      this.agentStartup.markRuntimeStarted(terminalId);
    }
  }

  private async submitTodoPrompt(
    taskId: string,
    terminalId: string,
    prompt: string,
  ): Promise<void> {
    if (!this.todos.markPromptSending(taskId, terminalId)) {
      throw new Error('任务已切换到其他终端，已取消本次发送。');
    }
    const located = this.findTerminal(terminalId);
    if (!located) {
      throw new Error('目标终端在发送指令前已关闭。');
    }
    this.rememberPromptDraft(located.workspace, located.terminal, prompt);
    await this.deliverTerminalPrompt(terminalId, prompt, true);
    this.promptAssets.captureInput(located.workspace, located.terminal, '\r');
    if (!this.todos.markPromptDelivered(taskId, terminalId)) {
      throw new Error('任务已切换到其他终端，无法确认本次发送。');
    }
  }

  /**
   * The draft is only a crash-recovery copy of what was handed to the agent, so failing to store
   * it must never cancel the delivery it exists to back up.
   */
  private rememberPromptDraft(
    workspace: Workspace,
    terminal: TerminalSession,
    content: string,
  ): void {
    void this.promptAssets.setDraft(workspace, terminal, content).catch(() => undefined);
  }

  /** @see terminalPromptWrites for why the prompt cannot travel in a single write. */
  private async deliverTerminalPrompt(
    terminalId: string,
    content: string,
    submit: boolean,
  ): Promise<void> {
    const writes = terminalPromptWrites(content, submit);
    for (const [index, data] of writes.entries()) {
      if (index > 0) {
        await this.settleTerminalInput();
      }
      await this.writeToTerminal(terminalId, data);
    }
  }

  private settleTerminalInput(): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, TERMINAL_INPUT_SETTLE_MS));
  }

  private async writeToTerminal(terminalId: string, data: string): Promise<void> {
    const located = this.findTerminal(terminalId);
    if (!located) {
      throw new Error('目标终端在发送指令前已关闭。');
    }
    await this.terminalGateway.write(located.terminal, data);
  }

  private initialTodoPrompt(task: TodoTask): string {
    const project = this.todos.project(task.projectId);
    return [
      '你正在执行 Termexo 任务看板中的一项任务。请直接在当前项目中完成实现。',
      '',
      `任务：${task.title}`,
      `项目：${project?.name ?? '当前项目'}`,
      `工作目录：${todoWorkingDirectory(task, project)}`,
      task.description ? `任务说明：\n${task.description}` : '',
      task.acceptanceCriteria ? `验收标准：\n${task.acceptanceCriteria}` : '',
      '',
      '请先检查现有实现，再完成所需修改并运行与风险相匹配的验证。完成后请总结改动、验证结果和仍需注意的问题。',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private continuationTodoPrompt(task: TodoTask, feedback: string): string {
    return [
      '这项任务的人工验收没有通过。请在当前会话上下文中继续修改，不要丢弃已经完成的工作。',
      '',
      `任务：${task.title}`,
      `未通过原因：\n${feedback.trim()}`,
      task.description ? `更新后的任务说明：\n${task.description}` : '',
      task.acceptanceCriteria ? `更新后的验收标准：\n${task.acceptanceCriteria}` : '',
      '',
      '请定位原因、完成修复并重新运行相关验证，然后清楚说明这次针对验收意见做了哪些修改。',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private storePreference(key: string, value: boolean | number | string): void {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // Persistence is optional in restricted webviews and test environments.
    }
  }

  private async selectTerminalDirectory(): Promise<string | null> {
    const workspace = this.state.activeWorkspace();
    if (!workspace) {
      return null;
    }

    try {
      return await this.directoryPicker.select(workspace.projectPath);
    } catch (error) {
      this.showToast(
        this.i18n.t('terminal.selectDirectoryFailed', { error: this.errorMessage(error) }),
      );
      return null;
    }
  }

  private openModelCredentialSettings(profileId: string, profileName: string): void {
    this.claudeLaunchOpen.set(false);
    this.codexLaunchOpen.set(false);
    this.openCodeLaunchOpen.set(false);
    this.sessionCenterOpen.set(false);
    this.closeModelSwitch();
    this.selectedTerminalDirectory.set(null);
    this.openSettings('models', profileId);
    this.showToast(this.i18n.t('profile.credentialRequired', { name: profileName }), 'attention');
  }

  private async initialize(): Promise<void> {
    await this.state.initialize();
    this.todos.initialize(this.state.workspaces());
    this.todos.reconcileTerminals(this.state.workspaces());
    await Promise.all([
      this.agents.initialize(),
      this.promptAssets.initialize(),
      this.handoffs.initialize(),
    ]);
    await this.refreshRestoredClaudeLaunches();
    await this.refreshRestoredCodexLaunches();
    await this.refreshRestoredOpenCodeLaunches();
    this.mountWorkspace(this.state.activeWorkspace()?.id);
    const recoveredDraft = this.state.activeTerminal()
      ? this.promptAssets.draftForTerminal(this.state.activeTerminal()!.id)
      : undefined;
    if (recoveredDraft) {
      this.showToast(this.i18n.t('prompt.recovered'));
    }
    void this.notifyWhenUpdateAvailable();
  }

  /**
   * Surfaces a published update once per version, then keeps checking periodically so a window
   * left open for days still learns about a release.
   *
   * The checks stay silent on failure: a machine that cannot reach GitHub never sees an error
   * it did not ask for.
   */
  private async notifyWhenUpdateAvailable(): Promise<void> {
    await this.updates.checkOnStartup();
    if (this.updates.shouldNotify()) {
      const result = this.updates.result();
      if (result) {
        this.announceUpdate(result);
      }
    }
    this.updates.startPeriodicChecks((result) => this.announceUpdate(result));
  }

  /**
   * Announces a release through both an in-app toast and a desktop notification, because a
   * periodic check usually fires while the user is working in another window.
   */
  private announceUpdate(result: UpdateCheck): void {
    const title = this.i18n.t('update.available', { version: result.latestVersion });
    this.showToast(title, 'attention');
    void this.desktopNotifications
      .notifyMessage(
        title,
        this.i18n.t('update.availableBody', {
          current: result.currentVersion,
          latest: result.latestVersion,
        }),
      )
      .catch(() => undefined);
    // Announcing once per version keeps a long session from repeating the same prompt.
    this.updates.dismissCurrentResult();
  }

  private async refreshRestoredClaudeLaunches(): Promise<void> {
    const profiles = this.agents.modelProfiles();
    const defaultProfile = profiles.find((profile) => profile.isDefault) ?? profiles[0];
    const restoredClaudeTerminals = this.state
      .workspaces()
      .flatMap((workspace) =>
        workspace.terminals
          .filter((terminal) => terminal.agentType === 'claude')
          .map((terminal) => ({ workspaceId: workspace.id, terminal })),
      );
    if (restoredClaudeTerminals.length === 0) {
      return;
    }

    // Session ids are resolved up front because reclaiming them asks the user one question about
    // the whole set, rather than one dialog per terminal as the launches run.
    const planned = restoredClaudeTerminals.map(({ workspaceId, terminal }) => {
      const task = this.todos
        .tasksFor(workspaceId)
        .find((candidate) => candidate.terminalId === terminal.id);
      return {
        workspaceId,
        terminal,
        profile:
          profiles.find((candidate) => candidate.id === terminal.profileId) ?? defaultProfile,
        sessionId: task
          ? compatibleTodoSessionId(task, this.agents.sessions(), this.agents.events())
          : compatibleNativeSessionId(
              'claude',
              terminal.nativeSessionId,
              undefined,
              this.agents.sessions(),
              this.agents.events(),
            ),
      };
    });
    const reclaim = await this.planBackgroundReclaim(planned.map((item) => item.sessionId));

    let skipped = 0;
    const results = await Promise.allSettled(
      planned.map(async ({ workspaceId, terminal, profile, sessionId }) => {
        if (!profile) {
          throw new Error(this.i18n.t('restore.noModelProfile', { name: terminal.name }));
        }
        if (needsCredential(profile, 'claude')) {
          throw new Error(this.i18n.t('restore.invalidCredential', { name: profile.name }));
        }

        // Present only for a session the CLI would still refuse to hand over.
        const blocked = sessionId ? reclaim.blocking.get(sessionId) : undefined;
        if (blocked && reclaim.resolution === 'skip') {
          skipped += 1;
          return;
        }

        const launch = await this.agents.prepareLaunch({
          terminalId: terminal.id,
          workspaceId,
          sessionId,
          profileId: profile.id,
          mcpProfileId: terminal.mcpProfileId,
          accountProfileId: terminal.accountProfileId,
          autoConfirm: terminal.autoConfirm,
          forkSession: Boolean(blocked) && reclaim.resolution === 'fork',
          attachShortId: blocked && reclaim.resolution === 'attach' ? blocked.shortId : undefined,
        });
        if (
          !this.state.updateRestoredTerminalLaunch(terminal.id, launch.command, {
            profileId: profile.id,
            model: profileModel(profile, 'claude'),
            nativeSessionId: sessionId,
          })
        ) {
          throw new Error(
            this.i18n.t('restore.terminalMissing', { agent: 'Claude', name: terminal.name }),
          );
        }
      }),
    );
    if (skipped > 0) {
      this.showToast(this.i18n.t('session.backgroundSkipped', { count: skipped }), 'attention');
    } else if (reclaim.blocking.size > 0 && reclaim.resolution === 'attach') {
      this.showToast(this.i18n.t('session.backgroundAttached'), 'attention');
    }
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      this.showToast(this.i18n.t('restore.claudeFailed', { count: failed }), 'attention');
    }
  }

  /**
   * Clears the CLI's hold on the sessions about to be resumed.
   *
   * Claude Code keeps a session alive when its terminal goes away and then refuses to resume it in
   * place. An idle one is stopped so its id is free again; a busy one is left running and handed to
   * the user, because stopping it would discard the turn it is in the middle of.
   */
  private async planBackgroundReclaim(sessionIds: readonly (string | undefined)[]): Promise<{
    blocking: Map<string, ClaudeBackgroundSession>;
    resolution: BackgroundSessionResolution;
  }> {
    const unique = [...new Set(sessionIds.filter((id): id is string => Boolean(id)))];
    const running = await Promise.all(
      unique.map((id) => this.agents.inspectClaudeBackgroundSession(id).catch(() => null)),
    );

    const blocking = new Map<string, ClaudeBackgroundSession>();
    let reclaimed = 0;
    for (const session of running) {
      if (!session) {
        continue;
      }
      if (session.busy) {
        blocking.set(session.sessionId, session);
        continue;
      }
      try {
        await this.agents.stopClaudeBackgroundSession(session.shortId);
        reclaimed += 1;
      } catch (error) {
        // A session that would not stop still owns its id, so it needs the same choice as a busy one.
        this.showToast(
          this.i18n.t('session.backgroundStopFailed', { error: this.errorMessage(error) }),
          'attention',
        );
        blocking.set(session.sessionId, session);
      }
    }
    if (reclaimed > 0) {
      this.showToast(this.i18n.t('session.backgroundReclaimed', { count: reclaimed }));
    }

    // With nothing blocking, no launch consults the resolution.
    if (blocking.size === 0) {
      return { blocking, resolution: 'skip' };
    }
    return { blocking, resolution: await this.askBackgroundResolution([...blocking.values()]) };
  }

  /**
   * Frees a single session id before it is resumed.
   *
   * Same rules as a restore: an idle session is stopped silently, a busy one is put to the user.
   */
  private async reclaimBackgroundSession(
    sessionId: string | undefined,
  ): Promise<BackgroundReclaim> {
    const reclaim = await this.planBackgroundReclaim([sessionId]);
    const blocked = sessionId ? reclaim.blocking.get(sessionId) : undefined;
    if (!blocked) {
      return { proceed: true, forkSession: false };
    }
    if (reclaim.resolution === 'skip') {
      return { proceed: false, forkSession: false };
    }
    return {
      proceed: true,
      forkSession: reclaim.resolution === 'fork',
      attachShortId: reclaim.resolution === 'attach' ? blocked.shortId : undefined,
    };
  }

  private askBackgroundResolution(
    sessions: readonly ClaudeBackgroundSession[],
  ): Promise<BackgroundSessionResolution> {
    this.backgroundSessions.set(sessions);
    return new Promise((resolve) => {
      this.backgroundSessionResolver = resolve;
    });
  }

  protected resolveBackgroundSessions(resolution: BackgroundSessionResolution): void {
    this.backgroundSessions.set([]);
    const resolver = this.backgroundSessionResolver;
    this.backgroundSessionResolver = null;
    resolver?.(resolution);
  }

  private async refreshRestoredCodexLaunches(): Promise<void> {
    const restoredCodexTerminals = this.state
      .workspaces()
      .flatMap((workspace) =>
        workspace.terminals
          .filter((terminal) => terminal.agentType === 'codex')
          .map((terminal) => ({ workspaceId: workspace.id, terminal })),
      );
    if (restoredCodexTerminals.length === 0) {
      return;
    }

    const profiles = this.agents.modelProfiles();
    const results = await Promise.allSettled(
      restoredCodexTerminals.map(async ({ workspaceId, terminal }) => {
        const profile = terminal.profileId
          ? profiles.find((candidate) => candidate.id === terminal.profileId)
          : undefined;
        const task = this.todos
          .tasksFor(workspaceId)
          .find((candidate) => candidate.terminalId === terminal.id);
        const sessionId = task
          ? compatibleTodoSessionId(task, this.agents.sessions(), this.agents.events())
          : compatibleNativeSessionId(
              'codex',
              terminal.nativeSessionId,
              undefined,
              this.agents.sessions(),
              this.agents.events(),
            );
        const launch = await this.agents.prepareCodexLaunch({
          terminalId: terminal.id,
          workspaceId,
          sessionId,
          profileId: profile?.id,
          model:
            terminal.model &&
            !terminal.model.includes('默认模型') &&
            !terminal.model.toLowerCase().includes('default model') &&
            !profile
              ? terminal.model
              : undefined,
          accountProfileId: terminal.accountProfileId,
          autoConfirm: terminal.autoConfirm,
        });
        if (
          !this.state.updateRestoredTerminalLaunch(terminal.id, launch.command, {
            profileId: profile?.id,
            model: profile ? profileModel(profile, 'codex') : terminal.model,
            nativeSessionId: sessionId,
          })
        ) {
          throw new Error(
            this.i18n.t('restore.terminalMissing', { agent: 'Codex', name: terminal.name }),
          );
        }
      }),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      this.showToast(this.i18n.t('restore.codexFailed', { count: failed }), 'attention');
    }
  }

  private async refreshRestoredOpenCodeLaunches(): Promise<void> {
    const restored = this.state
      .workspaces()
      .flatMap((workspace) =>
        workspace.terminals
          .filter((terminal) => terminal.agentType === 'opencode')
          .map((terminal) => ({ workspaceId: workspace.id, terminal })),
      );
    if (restored.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      restored.map(async ({ workspaceId, terminal }) => {
        const model = terminal.model.includes('默认模型') ? undefined : terminal.model;
        const launch = await this.agents.prepareOpenCodeLaunch({
          terminalId: terminal.id,
          workspaceId,
          sessionId: terminal.nativeSessionId,
          model,
          continueLast: !terminal.nativeSessionId,
        });
        if (
          !this.state.updateRestoredTerminalLaunch(terminal.id, launch.command, {
            model: terminal.model,
          })
        ) {
          throw new Error(
            this.i18n.t('restore.terminalMissing', { agent: 'OpenCode', name: terminal.name }),
          );
        }
      }),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      this.showToast(`有 ${failed} 个 OpenCode 终端恢复失败。`, 'attention');
    }
  }

  private mountWorkspace(workspaceId: string | undefined): void {
    if (!workspaceId || this.mountedWorkspaceIds().includes(workspaceId)) {
      return;
    }
    this.mountedWorkspaceIds.update((workspaceIds) => [...workspaceIds, workspaceId]);
  }
}
