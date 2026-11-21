import { NgTemplateOutlet } from '@angular/common';
import './core/i18n/workspace-tools.i18n';
import { RemoteReadOnlyViewComponent } from './remote/remote-read-only-view';
import { ProjectPreviewPanelComponent } from './preview/project-preview-panel';
import { ProjectPreviewService, type ProjectPreviewSession } from './core/services/project-preview.service';
import { CommonActionsDialogComponent } from './dialogs/common-actions-dialog';
import { CommonActionsService } from './core/services/common-actions.service';
import { terminalCommonAction, type CommonActionTerminalRequest } from './core/models/common-action';
import type { ProfileSaveCompleted, SettingsProfileKind } from './dialogs/profile-drafts';
import { ModelCatalogService } from './core/services/model-catalog.service';
import {
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import {
  ACCOUNT_AGENT_TYPES,
  type AccountAgentType,
  type AccountProfile,
  AccountProfileInput,
  type AgentEvent,
  AgentProtocol,
  BackgroundSessionResolution,
  chronologicalAgentEvents,
  ClaudeBackgroundSession,
  compatibleNativeSessionId,
  isAccountAgentType,
  type ManagedAgentType,
  McpProfileInput,
  ModelProfileInput,
  needsCredential,
  NetworkProfileInput,
  NetworkTestResult,
  profileModel,
  profileServes,
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
  ANTIGRAVITY_DEFAULT_MODEL,
  OPENCODE_DEFAULT_MODEL,
  TerminalStatus,
  TerminalSession,
  Workspace,
  AGENT_ICONS,
  AGENT_LABELS,
  TERMINAL_STATUS_META,
} from './core/models/workspace.models';
import type { HandoffPackage, HandoffRecord } from './core/models/handoff';
import type { PromptAsset } from './core/models/prompt-assets';
import type { RepositoryTarget } from './core/models/git.models';
import { createId } from './core/models/identifiers';

/** Visual tone for the corner toast region; the template maps each tone to a colour and icon. */
export type ToastTone = 'success' | 'info' | 'attention' | 'error';
import {
  TERMINAL_INPUT_SETTLE_MS,
  TERMINAL_PASTE_SETTLE_MS,
  terminalPromptWrites,
} from './core/models/terminal-input';
import type { TodoContinuationRequest, TodoTask } from './core/models/todo.models';
import {
  compatibleTodoSessionId,
  isReusableTodoTerminal,
  todoWorkingDirectory,
} from './core/models/todo.models';
import { I18nService } from './core/i18n/i18n.service';
import { localizeQuotaLabel } from './core/models/quota-label';
import { TranslatePipe } from './core/i18n/translate.pipe';
import {
  clearedNoticeStatus,
  collectGlobalTerminalNotices,
  createAttentionBanner,
  type GlobalNoticeCategory,
  globalNoticeCategory,
  globalNoticeKey,
  GlobalTerminalNotice,
  isAttentionNotice,
  newGlobalNotices,
} from './core/models/terminal-notifications';
import { createAppThemePalette } from './core/models/theme-palette';
import { AgentService } from './core/services/agent.service';
import { AccountLoginFeedbackService } from './core/services/account-login-feedback.service';
import { AppStateService } from './core/services/app-state.service';
import { DirectoryPickerService } from './core/services/directory-picker.service';
import { DesktopNotificationService } from './core/services/desktop-notification.service';
import { HandoffService } from './core/services/handoff.service';
import { GitService } from './core/services/git.service';
import { PromptAssetService } from './core/services/prompt-asset.service';
import { AgentStartupService } from './core/services/agent-startup.service';
import { TodoService } from './core/services/todo.service';
import { RemoteConnectionService } from './core/services/remote-connection.service';
import {
  hasBackend,
  isTauriRuntime,
  remoteRuntimeInfo,
  runtimeMode,
} from './core/services/tauri-runtime';
import { UpdateCheck, UpdateService } from './core/services/update.service';
import { WebviewStatusService } from './core/services/webview-status.service';
import { WindowControlsService } from './core/services/window-controls.service';
import {
  TerminalExitEvent,
  terminalEventMatchesSession,
  TerminalGatewayService,
} from './core/services/terminal-gateway.service';
import { AgentSettingsDialogComponent, type SettingsTab } from './dialogs/agent-settings-dialog';
import {
  ClaudeLaunchDialogComponent,
  ClaudeLaunchDialogValue,
} from './dialogs/claude-launch-dialog';
import { CodexLaunchDialogComponent, CodexLaunchDialogValue } from './dialogs/codex-launch-dialog';
import {
  AntigravityLaunchDialogComponent,
  type AntigravityLaunchDialogValue,
} from './dialogs/antigravity-launch-dialog';
import {
  OpenCodeLaunchDialogComponent,
  type OpenCodeLaunchDialogValue,
} from './dialogs/opencode-launch-dialog';
import { PiLaunchDialogComponent, type PiLaunchDialogValue } from './dialogs/pi-launch-dialog';
import {
  GrokLaunchDialogComponent,
  type GrokLaunchDialogValue,
} from './dialogs/grok-launch-dialog';
import { CreateWorkspaceDialogComponent } from './dialogs/create-workspace-dialog';
import { DirectoryPromptDialogComponent } from './dialogs/directory-prompt-dialog';
import { WebviewUpgradeDialogComponent } from './dialogs/webview-upgrade-dialog';
import { BackgroundSessionDialogComponent } from './dialogs/background-session-dialog';
import { DeleteWorkspaceDialogComponent } from './dialogs/delete-workspace-dialog';
import { EditWorkspaceDialogComponent } from './dialogs/edit-workspace-dialog';
import type { WorkspaceAppearanceValue } from './dialogs/edit-workspace-dialog';
import { MergeWorkspaceDialogComponent } from './dialogs/merge-workspace-dialog';
import { AccountSwitchDialogComponent } from './dialogs/account-switch-dialog';
import { ModelSwitchDialogComponent, ModelSwitchValue } from './dialogs/model-switch-dialog';
import {
  HandoffDialogComponent,
  type HandoffGenerateRequest,
  type HandoffSendRequest,
} from './dialogs/handoff-dialog';
import { PromptLibraryDialogComponent } from './dialogs/prompt-library-dialog';
import { RemoteHostsDialogComponent } from './dialogs/remote-hosts-dialog';
import { ResumeSessionValue, SessionCenterDialogComponent } from './dialogs/session-center-dialog';
import { InspectorPanelComponent } from './inspector/inspector-panel';
import { RemoteAccessGateComponent } from './remote/remote-access-gate';
import { RemoteConnectionBadgeComponent } from './remote/remote-connection-badge';
import { AgentLaunchOptionsComponent } from './shared/agent-launch-options/agent-launch-options';
import { AnchoredMenuDirective } from './shared/anchored-menu.directive';
import { IconComponent } from './shared/icon/icon';
import { TopbarOverflowMenuComponent } from './shared/topbar-overflow-menu/topbar-overflow-menu';
import { WorkspaceOnboardingComponent } from './workspace/workspace-onboarding';
import {
  DEFAULT_TERMINAL_FONT_NAME,
  isTerminalFontAvailable,
  normalizeTerminalFontName,
  TERMINAL_FONT_NAME_STORAGE_KEY,
} from './terminal/terminal-font';
import { TerminalInputStatusTracker } from './terminal/terminal-input-status';
import { AGENT_INTERRUPT_SEQUENCE, workbenchShortcut } from './terminal/terminal-key-sequences';
import {
  layoutTerminalCapacity,
  resolveVisibleTerminalIds,
  revealTerminalInLayout,
} from './terminal/terminal-visibility';
import { TerminalToolbarComponent } from './terminal/terminal-toolbar';
import { TerminalWorkbenchComponent } from './terminal/terminal-workbench';
import { TerminalCloseConfirmComponent } from './terminal/terminal-close-confirm';
import type { CloseConfirmAnchor } from './terminal/terminal-close-request';
import { TodoBoardComponent } from './todo/todo-board';
import { CLI_NATIVE_PROFILE_ID, explicitCliModel, matchesRunningModel } from './core/models/launch-model-choice';
import { WorkspaceSidebarComponent } from './workspace/workspace-sidebar';
import { GitWorkbenchComponent } from './git/git-workbench';

type SidebarResizeTarget = 'workspace' | 'inspector';
type WorkspaceTool = 'common-actions' | 'tasks' | 'git' | 'sessions';
type WorkspaceView = 'terminal' | 'preview' | WorkspaceTool;
type WorkbenchTab =
  | { view: 'terminal'; id: string; terminal: TerminalSession }
  | { view: 'preview'; id: string; preview: ProjectPreviewSession }
  | { view: WorkspaceTool; id: WorkspaceTool };

const WORKSPACE_TOOL_TABS = {
  'common-actions': { label: 'commonActions.title', icon: 'command' },
  tasks: { label: 'workspace.viewTasks', icon: 'layout' },
  git: { label: 'git.button', icon: 'git-branch' },
  sessions: { label: 'terminal.sessionCenter', icon: 'history' },
} satisfies Record<WorkspaceTool, { label: string; icon: string }>;

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
/**
 * Below this the window is a phone held upright, reached through remote access.
 *
 * At that width the split layouts stop being usable — two panels would each get a strip too
 * short to read a wrapped agent reply in — so the workspace is drawn single, and the controls
 * that only steer splitting leave the toolbar to the tab strip.
 */
const PHONE_LAYOUT_MAX_WIDTH = 640;
/** How often the repository is re-read while a view that shows it is open and unwatched. */
const GIT_POLL_INTERVAL_MS = 3_000;
/**
 * The safety net once the backend watches the repository: changes arrive as events, and this only
 * catches one the watcher missed — a file system that delivers them late, or not at all.
 */
const GIT_WATCHED_POLL_INTERVAL_MS = 60_000;
/** The task board needs the repository only for the count on the Git tab, so it checks rarely. */
const GIT_IDLE_POLL_INTERVAL_MS = 15_000;
/** Matches the backend default for a profile that has never had a threshold set. */
const DEFAULT_ALERT_THRESHOLD = 80;
/** Checks for model activity often, while the backend cache controls actual provider requests. */
const QUOTA_ACTIVITY_CHECK_INTERVAL_MS = 30_000;
/** Keeps a short completed model turn eligible for the next automatic refresh. */
const QUOTA_RECENT_ACTIVITY_WINDOW_MS = 90_000;
/**
 * How a finished sign-in is noticed.
 *
 * The login CLI writes its credentials the moment the browser flow returns, but it does not
 * necessarily exit — waiting for the process to end can mean waiting forever. Polling the
 * account instead catches the new state a few seconds after the user finishes, whether or not
 * the terminal is still open.
 */
const ACCOUNT_LOGIN_POLL_INTERVAL_MS = 4_000;
const ACCOUNT_LOGIN_POLL_TIMEOUT_MS = 300_000;
/** The global notice button's summary, one count per kind of notice in this order. */
const GLOBAL_NOTICE_SUMMARY_KEYS: ReadonlyArray<{ category: GlobalNoticeCategory; key: string }> = [
  { category: 'waiting', key: 'notice.waitingCount' },
  { category: 'issue', key: 'notice.issueCount' },
  { category: 'completed', key: 'notice.completedCount' },
];

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
    NgTemplateOutlet,
    RemoteReadOnlyViewComponent,
    ProjectPreviewPanelComponent,
    CommonActionsDialogComponent,
    AgentLaunchOptionsComponent,
    AnchoredMenuDirective,
    AgentSettingsDialogComponent,
    ClaudeLaunchDialogComponent,
    CodexLaunchDialogComponent,
    AntigravityLaunchDialogComponent,
    OpenCodeLaunchDialogComponent,
    GrokLaunchDialogComponent,
    PiLaunchDialogComponent,
    CreateWorkspaceDialogComponent,
    DirectoryPromptDialogComponent,
    BackgroundSessionDialogComponent,
    DeleteWorkspaceDialogComponent,
    EditWorkspaceDialogComponent,
    HandoffDialogComponent,
    GitWorkbenchComponent,
    IconComponent,
    InspectorPanelComponent,
    TopbarOverflowMenuComponent,
    WorkspaceOnboardingComponent,
    MergeWorkspaceDialogComponent,
    AccountSwitchDialogComponent,
    ModelSwitchDialogComponent,
    PromptLibraryDialogComponent,
    RemoteAccessGateComponent,
    RemoteConnectionBadgeComponent,
    RemoteHostsDialogComponent,
    SessionCenterDialogComponent,
    TerminalToolbarComponent,
    TerminalWorkbenchComponent,
    TerminalCloseConfirmComponent,
    TodoBoardComponent,
    TranslatePipe,
    WebviewUpgradeDialogComponent,
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
  private readonly injector = inject(Injector);
  protected readonly state = inject(AppStateService);
  protected readonly commonActions = inject(CommonActionsService);
  protected readonly preview = inject(ProjectPreviewService);
  private pendingCommonActionLaunch: string | null = null;
  private readonly returnToCommonActionReview = signal<{ workspaceId: string; requestId: string } | null>(null);
  protected readonly agents = inject(AgentService);
  private readonly loginFeedback = inject(AccountLoginFeedbackService);
  protected readonly modelCatalog = inject(ModelCatalogService);
  protected readonly i18n = inject(I18nService);
  protected readonly updates = inject(UpdateService);
  protected readonly windowControls = inject(WindowControlsService);
  protected readonly remoteConnection = inject(RemoteConnectionService);
  protected readonly previewMode = runtimeMode() === 'preview';
  protected readonly canOpenDirectory = runtimeMode() === 'desktop';
  protected readonly profileSaving = signal(false);
  /**
   * Set while a profile delete round-trip is in flight so the four delete buttons (and their
   * confirmation row) stay disabled for the duration. The dialog disables every editor button
   * via its `busy()` input, but that input previously had no delete signal and only `agents.busy()`
   * flipped when something else (CLI install, npm update) was busy — so a delete could fire while
   * another profile's save was still running, and the user could double-submit a delete.
   */
  protected readonly profileDeleting = signal(false);
  /** True only in the browser client served by the desktop app's remote access server. */
  protected readonly remoteMode = this.remoteConnection.mode === 'remote';
  protected readonly directoryPicker = inject(DirectoryPickerService);
  protected readonly webviewStatus = inject(WebviewStatusService);
  private readonly desktopNotifications = inject(DesktopNotificationService);
  private readonly terminalGateway = inject(TerminalGatewayService);
  protected readonly promptAssets = inject(PromptAssetService);
  protected readonly handoffs = inject(HandoffService);
  protected readonly git = inject(GitService);
  protected readonly todos = inject(TodoService);
  protected readonly agentStartup = inject(AgentStartupService);
  private readonly handledEventKeys = new Set<string>();
  private readonly handledPlanAlertKeys = new Set<string>();
  private readonly preferredTerminalIds = signal<Record<string, string[]>>({});
  private readonly mountedWorkspaceIds = signal<string[]>([]);
  /** Set once the stored workspaces are in place, which is when notices start meaning anything. */
  private readonly workspacesLoaded = signal(false);
  /** Null until the notices this client loaded with have been taken as already announced. */
  private previousGlobalNoticeKeys: ReadonlySet<string> | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private previousViewportWidth = Number.POSITIVE_INFINITY;
  /** Pending or settled load of the task-flow wording; see {@link loadTodoTranslations}. */
  private todoTranslations?: Promise<void>;

  /** True while the window is phone width; kept in step by `adaptLayoutToViewport`. */
  protected readonly phoneLayout = signal(window.innerWidth <= PHONE_LAYOUT_MAX_WIDTH);
  protected readonly createWorkspaceOpen = signal(false);
  protected readonly creatingWorkspace = signal(false);
  protected readonly createWorkspaceError = signal<string | null>(null);
  private readonly pendingOnboardingAgent = signal<AgentType | null>(null);
  private readonly workspaceTabScope = computed(() => this.state.activeWorkspace()?.id ?? null);
  protected readonly workspaceView = linkedSignal({
    source: this.workspaceTabScope,
    computation: (): WorkspaceView => 'terminal',
  });
  private readonly openedWorkspaceTools = signal<{ workspaceId: string | null; tool: WorkspaceTool }[]>([]);
  protected readonly workspaceTools = computed(() => {
    const workspaceId = this.workspaceTabScope();
    return this.openedWorkspaceTools().filter((tab) => tab.workspaceId === workspaceId);
  });
  protected readonly workspaceToolTabs = WORKSPACE_TOOL_TABS;
  protected readonly tabMinWidth = 124;
  protected readonly tabOverflowWidth = 32;
  private readonly tabBar = viewChild<ElementRef<HTMLElement>>('tabBar');
  private readonly newTabAnchor = viewChild<ElementRef<HTMLElement>>('newTabAnchor');
  private readonly tabAvailableWidth = signal<number | null>(null);
  private readonly workbenchTabs = computed<WorkbenchTab[]>(() => [
    ...(this.state.activeWorkspace()?.terminals ?? []).map((terminal) => ({
      view: 'terminal' as const, id: terminal.id, terminal,
    })),
    ...this.preview.workspaceTabs().map((preview) => ({
      view: 'preview' as const, id: preview.id, preview,
    })),
    ...this.workspaceTools().map(({ tool }) => ({ view: tool, id: tool })),
  ]);
  private readonly activeWorkbenchTabIndex = computed(() => {
    const view = this.workspaceView();
    const id = view === 'terminal' ? this.activeTerminalId()
      : view === 'preview' ? this.preview.activeTab()?.id : view;
    return this.workbenchTabs().findIndex((tab) => tab.view === view && tab.id === id);
  });
  protected readonly tabVisibility = computed(() => {
    const tabs = this.workbenchTabs();
    const width = this.tabAvailableWidth();
    const count = width === null || tabs.length * this.tabMinWidth <= width
      ? tabs.length
      : Math.max(1, Math.floor((width - this.tabOverflowWidth) / this.tabMinWidth));
    const shown = tabs.slice(0, count);
    const activeIndex = this.activeWorkbenchTabIndex();
    if (activeIndex >= count) shown[count - 1] = tabs[activeIndex];
    const visible = new Set(shown.map((tab) => this.workbenchTabId(tab.view, tab.id)));
    return {
      visible,
      overflow: tabs.filter((tab) => !visible.has(this.workbenchTabId(tab.view, tab.id))),
    };
  });
  protected readonly tabMenuOpen = linkedSignal({
    source: computed(() => this.tabVisibility().overflow.length && !this.terminalFocusMode()
      ? this.workspaceTabScope()
      : null),
    computation: () => false,
  });
  protected readonly busyTodoTaskId = signal<string | null>(null);
  protected readonly editingWorkspaceId = signal<string | null>(null);
  protected readonly claudeLaunchOpen = signal(false);
  protected readonly codexLaunchOpen = signal(false);
  protected readonly openCodeLaunchOpen = signal(false);
  protected readonly grokLaunchOpen = signal(false);
  protected readonly piLaunchOpen = signal(false);
  protected readonly launchingPi = signal(false);
  protected readonly antigravityLaunchOpen = signal(false);
  protected readonly launchingAntigravity = signal(false);
  protected readonly remoteHostsOpen = signal(false);
  protected readonly promptLibraryOpen = signal(false);
  /** Empty until the shell reports it, and in browser preview, where there is no packaged build. */
  protected readonly appVersion = signal('');
  /** Login terminal id to the account it signs in, so its exit can refresh that account. */
  private readonly pendingAccountLogins = new Map<string, string>();
  protected readonly handoffOpen = signal(false);
  protected readonly handoffPreview = signal<HandoffPackage | null>(null);
  protected readonly handoffSending = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly settingsInitialTab = signal<SettingsTab>('diagnostics');
  protected readonly settingsInitialModelProfileId = signal('');
  protected readonly profileSaveCompleted = signal<ProfileSaveCompleted | null>(null);
  /** The agent the settings window opens on when a launch dialog sent the user to install it. */
  protected readonly settingsInitialCliAgent = signal<ManagedAgentType | ''>('');
  protected readonly modelSwitchOpen = signal(false);
  /** Terminal the switch applies to; null means every terminal of that agent type. */
  protected readonly modelSwitchTerminalId = signal<string | null>(null);
  /** Agent type to preselect when the switch targets one terminal. */
  protected readonly modelSwitchAgentType = signal<AgentProtocol | null>(null);
  protected readonly modelSwitchTerminal = computed(() =>
    this.state.activeWorkspace()?.terminals.find(terminal => terminal.id === this.modelSwitchTerminalId()),
  );
  protected readonly switchSettingsProfile = signal('');
  protected readonly accountSwitchOpen = signal(false);
  protected readonly switchingAccount = signal(false);
  /** Terminal the account switch applies to; accounts are always switched one terminal at a time. */
  protected readonly accountSwitchTerminalId = signal<string | null>(null);
  protected readonly accountSwitchAgentType = signal<AccountAgentType | null>(null);
  protected readonly accountSwitchTerminal = computed(() => {
    const terminalId = this.accountSwitchTerminalId();
    if (!terminalId) {
      return null;
    }
    return this.state.activeWorkspace()?.terminals.find((item) => item.id === terminalId) ?? null;
  });
  /** Resolved the same way the terminal's own chip is labelled, so both name one account. */
  protected readonly accountSwitchCurrentId = computed(() => {
    const terminal = this.accountSwitchTerminal();
    if (!terminal || !isAccountAgentType(terminal.agentType)) {
      return '';
    }
    return (
      resolveAccountProfileId(
        this.agents.accountProfiles(),
        terminal.agentType,
        terminal.accountProfileId,
      ) ?? ''
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
  protected readonly terminalFillsLayout = signal(false);
  protected readonly layoutRevision = signal(0);
  protected readonly launchingClaude = signal(false);
  protected readonly launchingCodex = signal(false);
  protected readonly launchingOpenCode = signal(false);
  protected readonly launchingGrok = signal(false);
  /** Stable reference so the session center input does not change every check. */
  protected readonly sessionLaunchProfiles = (nativeSessionId: string) =>
    this.state.findSessionLaunchProfiles(nativeSessionId);
  protected readonly selectedTerminalDirectory = signal<string | null>(null);
  protected readonly toastMessage = signal<string | null>(null);
  protected readonly toastAction = signal<{ label: string; run: () => void } | null>(null);
  protected readonly toastTone = signal<ToastTone>('success');
  /** A running terminal waits for confirmation near the close action's click position. */
  protected readonly pendingTerminalClose = signal<string | null>(null);
  protected readonly terminalCloseAnchor = signal<CloseConfirmAnchor>({ x: 0, y: 0 });
  /**
   * Set while a forced close is round-tripping through the gateway so a double-click on the
   * "Close anyway" button does not call `terminalGateway.close` twice on the same id.
   */
  protected readonly closingTerminal = signal(false);
  /** IDs successive toasts, so a fresh message replaces the running auto-dismiss timer. */
  private toastTimer: number | null = null;
  protected readonly dismissedNoticeKeys = signal<ReadonlySet<string>>(new Set());
  protected readonly workspacePendingDeletion = signal<Workspace | null>(null);
  protected readonly deletingWorkspace = signal(false);
  protected readonly workspacePendingMerge = signal<Workspace | null>(null);
  protected readonly mergingWorkspace = signal(false);
  protected readonly networkTestResult = signal<NetworkTestResult | null>(null);
  /** The agents' own marks, for the tab strip. */
  protected readonly agentIcons = AGENT_ICONS;

  protected readonly activeTerminalId = computed(() => this.state.activeTerminal()?.id ?? null);
  protected readonly terminalFocusMode = linkedSignal<string | null, boolean>({
    source: () => this.workspaceView() === 'terminal' && this.activeTerminalId()
      ? this.workspaceTabScope()
      : null,
    computation: (workspaceId, previous) =>
      workspaceId !== null && previous?.source === workspaceId && previous.value,
  });
  protected readonly showOnlyActiveTerminal = computed(
    () => this.terminalFillsLayout() || this.terminalFocusMode(),
  );
  protected readonly gitTarget = computed<RepositoryTarget | null>(
    () => {
      const workspace = this.state.activeWorkspace();
      const terminal = this.state.activeTerminal();
      if (!workspace || !terminal) return null;
      return {
        workspaceId: workspace.id,
        terminalId: terminal.id,
        runtimeRevision: terminal.runtimeRevision ?? 0,
      };
    },
    {
      equal: (left, right) =>
        left === right ||
        (left !== null &&
          right !== null &&
          left.workspaceId === right.workspaceId &&
          left.terminalId === right.terminalId &&
          left.runtimeRevision === right.runtimeRevision),
    },
  );
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
  protected readonly globalNoticeOpen = linkedSignal({
    source: computed(() => this.globalTerminalNotices().length > 0 && !this.terminalFocusMode()),
    computation: () => false,
  });
  protected readonly hasAttentionNotices = computed(() =>
    this.globalTerminalNotices().some(isAttentionNotice),
  );
  protected readonly attentionBanner = computed(() => {
    const dismissed = this.dismissedNoticeKeys();
    return createAttentionBanner(
      this.globalTerminalNotices().filter((notice) => !dismissed.has(globalNoticeKey(notice))),
      (key, params) => this.i18n.t(key, params),
    );
  });
  protected readonly globalNoticeSummary = computed(() => {
    const notices = this.globalTerminalNotices();
    return GLOBAL_NOTICE_SUMMARY_KEYS.map(({ category, key }) => ({
      key,
      count: notices.filter((notice) => globalNoticeCategory(notice) === category).length,
    }))
      .filter(({ count }) => count > 0)
      .map(({ key, count }) => this.i18n.t(key, { count }))
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
    return this.i18n.t(TERMINAL_STATUS_META[status].labelKey);
  }

  protected statusTone(status: TerminalStatus): string {
    return TERMINAL_STATUS_META[status].tone;
  }

  protected statusMeta(status: TerminalStatus): { tone: string; labelKey: string; pulse: boolean } {
    return TERMINAL_STATUS_META[status];
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
      this.renderedLayout(workspace.layout),
      this.showOnlyActiveTerminal(),
      this.gridColumns(),
      this.gridRows(),
    );
  });

  constructor() {
    effect((onCleanup) => {
      const bar = this.tabBar()?.nativeElement;
      const newTab = this.newTabAnchor()?.nativeElement;
      if (!bar || !newTab) return;
      let previousWidth: number | null = null;
      const measure = () => {
        const barWidth = bar.getBoundingClientRect().width;
        if (!barWidth) return;
        const width = Math.max(0, barWidth - newTab.getBoundingClientRect().width);
        if (width === previousWidth) return;
        previousWidth = width;
        this.tabAvailableWidth.set(width);
        this.tabMenuOpen.set(false);
      };
      measure();
      if (typeof ResizeObserver === 'undefined') {
        window.addEventListener('resize', measure);
        onCleanup(() => window.removeEventListener('resize', measure));
        return;
      }
      const observer = new ResizeObserver(measure);
      observer.observe(bar);
      observer.observe(newTab);
      onCleanup(() => observer.disconnect());
    });
    effect(() => {
      const pending = this.returnToCommonActionReview();
      if (!pending) return;
      const review = this.commonActions.reviews()[pending.workspaceId];
      if (!review || review.requestId !== pending.requestId) {
        this.returnToCommonActionReview.set(null);
      } else if (!review.waiting) {
        this.returnToCommonActionReview.set(null);
        if (this.state.activeWorkspace()?.id === pending.workspaceId) this.openWorkspaceTool('common-actions');
      }
    });
    effect(() => {
      this.preview.activation();
      // Terminal state updates are not navigation requests. Only an explicit preview activation
      // may select this view; reading the workspace here used to steal focus on every status change.
      untracked(() => {
        if (this.preview.open()) this.workspaceView.set('preview');
      });
    });
    effect(() => {
      if (!this.preview.open() && untracked(() => this.workspaceView()) === 'preview') {
        this.workspaceView.set('terminal');
      }
    });
    this.adaptLayoutToViewport();
    if (hasBackend()) this.modelCatalog.initialize();
    void this.initialize();
    effect(() => {
      const unhandled = this.agents
        .events()
        .filter((event) => !this.handledEventKeys.has(event.eventKey));
      // Applying reads terminal state, which must not make this effect rerun on every change.
      untracked(() => {
        for (const event of chronologicalAgentEvents(unhandled)) {
          this.handledEventKeys.add(event.eventKey);
          this.applyAgentEvent(event);
        }
      });
    });
    effect((onCleanup) => {
      const targetChanged = this.git.selectTarget(this.gitTarget());
      const view = this.workspaceView();
      if (view === 'git' && !targetChanged) {
        untracked(() => void this.git.refresh());
      }
      // Polling used to stop the moment the Git view was opened, so the one view that shows these
      // changes was the only one where they went stale until the user pressed refresh. Once the
      // backend watches the repository the poll is only a safety net, so it backs right off.
      const interval = this.git.watched()
        ? GIT_WATCHED_POLL_INTERVAL_MS
        : view === 'tasks'
          ? GIT_IDLE_POLL_INTERVAL_MS
          : GIT_POLL_INTERVAL_MS;
      const timer = window.setInterval(() => void this.git.refresh(), interval);
      onCleanup(() => window.clearInterval(timer));
    });
    effect(() => {
      if (!this.workspacesLoaded()) return;
      // The full list owns taskbar attention: opening the window or dismissing a banner does not
      // confirm a completion or answer an approval. Status changes and explicit clearing do.
      this.desktopNotifications.syncTaskbarAttention(this.globalTerminalNotices());
    });
    effect(() => {
      if (!this.workspacesLoaded()) {
        return;
      }
      const notices = this.globalTerminalNotices();
      const currentKeys = new Set(notices.map(globalNoticeKey));
      const newNotices = newGlobalNotices(notices, this.previousGlobalNoticeKeys);
      this.previousGlobalNoticeKeys = currentKeys;
      this.forgetResolvedDismissals(currentKeys);
      if (newNotices.length > 0) {
        void this.desktopNotifications.notify(newNotices);
      }

      // Terminals that need the user are surfaced by the persistent attention banner instead, so
      // the transient toast only reports completions.
      const completed = newNotices.filter((notice) => !isAttentionNotice(notice));
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
    void this.loadAppVersion();
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
              label: localizeQuotaLabel(entry.label, (key, params) => this.i18n.t(key, params)),
              percent: Math.round(entry.percent),
            }),
            'attention',
          );
        }
      }
    });
  }

  /**
   * Reads the packaged version from the shell rather than from a duplicated constant — the
   * version already lives in several manifests and adding another copy would be one more thing
   * to forget on release. Browser preview has no package to ask, so the label stays hidden.
   */
  private async loadAppVersion(): Promise<void> {
    // The app plugin is not on the remote command allowlist, so a remote client reads the version
    // the server injected into the page instead of asking the shell for it.
    const remote = remoteRuntimeInfo();
    if (remote) {
      this.appVersion.set(remote.version);
      return;
    }
    if (!isTauriRuntime()) {
      return;
    }
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      this.appVersion.set(await getVersion());
    } catch {
      // The label is informational; failing to read it must not disturb startup.
    }
  }

  /**
   * Moves a terminal, and the task running in it, to the status a hook reported — unless the
   * terminal has moved on since the hook fired.
   */
  private applyAgentEvent(event: AgentEvent): void {
    if (this.state.isSupersededAgentEvent(event)) {
      return;
    }
    this.state.applyAgentEvent(event);
    this.todos.applyAgentEvent(event);
  }

  /**
   * Marks a terminal whose process ended.
   *
   * An agent that never starts — a missing executable, a rejected credential, a CLI that exits
   * immediately — otherwise leaves a tile sitting at "running" with nothing behind it. A failed
   * exit raises the terminal's attention notice, which is what tells the user about it.
   */
  private handleTerminalExit(event: TerminalExitEvent): void {
    if (this.remoteConnection.readOnly()) return;
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
    const loggingInProfileId = this.pendingAccountLogins.get(event.terminalId);
    if (loggingInProfileId !== undefined) {
      this.pendingAccountLogins.delete(event.terminalId);
      void this.refreshAccountAfterLogin(loggingInProfileId, event.terminalId, event.success && !event.intentional);
    }
    const status = event.intentional
      ? 'STOPPED'
      : event.success ? (terminal.commonActionId ? 'COMPLETED' : 'STOPPED') : 'FAILED';
    this.state.markTerminalExited(event.terminalId, status);
    this.todos.handleTerminalStatus(event.terminalId, status);
    this.agentStartup.cancel(event.terminalId);
  }

  /** `force` skips the backend's short-lived cache, for the panel's refresh button. */
  protected async refreshProviderQuotas(force = false): Promise<void> {
    await this.agents.refreshProviderQuotas(this.state.activeWorkspace()?.id, force);
  }

  /** Keep the picked Agent while the first project is being created. */
  protected launchFromOnboarding(agentType: AgentType): void {
    if (this.state.activeWorkspace()) {
      void this.launchAgent(agentType);
      return;
    }
    this.pendingOnboardingAgent.set(agentType);
    this.createWorkspaceOpen.set(true);
  }

  protected cancelWorkspaceCreation(): void {
    if (this.creatingWorkspace()) return;
    this.pendingOnboardingAgent.set(null);
    this.createWorkspaceError.set(null);
    this.createWorkspaceOpen.set(false);
  }

  /** The tab strip and onboarding both use the existing launch confirmation dialogs. */
  protected async launchAgent(agentType: AgentType): Promise<void> {
    switch (agentType) {
      case 'claude':
        await this.openClaudeLaunch();
        break;
      case 'codex':
        await this.openCodexLaunch();
        break;
      case 'opencode':
        await this.openOpenCodeLaunch();
        break;
      case 'pi':
        this.openPiLaunch();
        break;
      case 'grok':
        await this.openGrokLaunch();
        break;
      case 'antigravity':
        await this.openAntigravityLaunch();
        break;
      case 'shell':
        await this.createTerminal('shell');
        break;
    }
  }

  protected async openProjectPreview(): Promise<void> {
    const workspace = this.state.activeWorkspace();
    this.agentMenuOpen.set(false);
    if (!workspace) return;
    await this.preview.browse(workspace.id);
  }

  protected openCommonActionTerminal(terminalId: string): void {
    this.revealCreatedTerminal(terminalId);
  }

  protected async controlCommonAction(request: CommonActionTerminalRequest): Promise<void> {
    if (this.remoteConnection.readOnly()) return;
    const located = this.findTerminal(request.terminalId);
    if (!located || this.commonActions.busy().has(located.workspace.id)) return;
    const action = terminalCommonAction(located.terminal, located.workspace.commonActions ?? []);
    if (!action) return;
    try {
      if (request.operation === 'stop') {
        await this.commonActions.stop(located.workspace.id, action.id);
      } else {
        const terminalId = await this.commonActions.run(
          located.workspace.id, action.id, request.operation === 'restart',
        );
        this.openCommonActionTerminal(terminalId);
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    }
  }

  protected async startCommonActionAgent(): Promise<void> {
    const workspace = this.state.activeWorkspace();
    if (!workspace || this.commonActions.reviews()[workspace.id]?.waiting) return;
    if (!hasBackend()) {
      this.reportFailure('请连接桌面应用后识别项目。');
      return;
    }
    this.pendingCommonActionLaunch = workspace.id;
    await this.openCodexLaunch();
    if (!this.codexLaunchOpen()) {
      this.pendingCommonActionLaunch = null;
    }
  }

  protected viewCommonActionAgent(terminalId: string): void {
    const workspace = this.state.activeWorkspace();
    const review = workspace && this.commonActions.reviews()[workspace.id];
    if (workspace && review?.waiting && review.terminalId === terminalId) {
      this.returnToCommonActionReview.set({ workspaceId: workspace.id, requestId: review.requestId });
    }
    this.revealCreatedTerminal(terminalId);
  }

  private async submitCommonActionRecognition(workspaceId: string, terminalId: string, requestId: string): Promise<void> {
    const review = this.commonActions.reviews()[workspaceId];
    if (!review?.waiting || review.requestId !== requestId) return;
    const workspace = this.state.workspaces().find((item) => item.id === workspaceId);
    if (!workspace) return;
    const { recognitionPrompt } = await import('./core/models/common-action-recognition');
    // Cancellation may happen while the prompt module is loading.
    const current = this.commonActions.reviews()[workspaceId];
    if (!current?.waiting || current.requestId !== requestId) return;
    this.commonActions.updateRecognition(workspaceId, requestId, { phase: 'reading' });
    await this.deliverTerminalPrompt(terminalId, recognitionPrompt(workspace.projectPath, workspaceId, requestId), true);
  }

  protected async recognizeCommonActions(request: {
    workspaceId: string;
    terminalId: string;
  }): Promise<void> {
    if (this.commonActions.reviews()[request.workspaceId]?.waiting) return;
    let requestId: string | undefined;
    try {
      if (!hasBackend()) throw new Error('请在桌面应用中识别项目。');
      const located = this.findTerminal(request.terminalId);
      if (
        !located ||
        located.workspace.id !== request.workspaceId ||
        located.terminal.agentType === 'shell' ||
        !['IDLE', 'COMPLETED'].includes(located.terminal.status) ||
        located.terminal.accountLogin
      )
        throw new Error('请选择当前项目已就绪的空闲 Agent。');
      requestId = this.commonActions.beginRecognition(request.workspaceId, request.terminalId);
      const live = await this.terminalGateway.liveTerminals();
      if (!live.has(request.terminalId)) throw new Error('Agent 已断开，请先重新启动。');
      await this.submitCommonActionRecognition(request.workspaceId, request.terminalId, requestId);
    } catch (error) {
      if (requestId) this.commonActions.updateRecognition(request.workspaceId, requestId, { waiting: false, error: this.errorMessage(error) });
      this.reportFailure(this.errorMessage(error));
    }
  }

  protected async createTerminal(agentType: AgentType): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = await this.selectTerminalDirectory();
    if (!workingDirectory) {
      return;
    }

    const terminal = this.state.createTerminal({ agentType, workingDirectory });
    if (terminal) {
      this.revealCreatedTerminal(terminal.id);
      this.showToast(this.i18n.t('terminal.created', { name: terminal.name }));
    }
  }

  protected async openClaudeLaunch(): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = this.state.activeWorkspace()?.projectPath;
    if (!workingDirectory) {
      return;
    }

    this.selectedTerminalDirectory.set(workingDirectory);
    this.refreshAccountsFor('claude');
    this.claudeLaunchOpen.set(true);
  }

  /**
   * Re-reads one agent's accounts in the background, without holding up the dialog.
   *
   * The launch dialog renders each account's signed-in state from the cached list, which only
   * changes when something asks the CLI. A sign-in finished after the app started — including
   * one done in Termexo's own login terminal — would otherwise still read as signed out here.
   */
  private refreshAccountsFor(agentType: AccountProfile['agentType']): void {
    for (const profile of this.agents.accountProfiles()) {
      if (profile.agentType === agentType) {
        void this.agents.refreshAccountProfile(profile.id).catch(() => undefined);
      }
    }
  }

  protected async openCodexLaunch(): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = this.state.activeWorkspace()?.projectPath;
    if (!workingDirectory) {
      return;
    }
    this.selectedTerminalDirectory.set(workingDirectory);
    this.refreshAccountsFor('codex');
    this.codexLaunchOpen.set(true);
  }

  protected async openAntigravityLaunch(): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = this.state.activeWorkspace()?.projectPath;
    if (!workingDirectory) {
      return;
    }
    this.selectedTerminalDirectory.set(workingDirectory);
    this.antigravityLaunchOpen.set(true);
  }

  protected async launchAntigravity(value: AntigravityLaunchDialogValue): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const workingDirectory = this.selectedTerminalDirectory();
    if (!workspace || !workingDirectory || this.launchingAntigravity()) {
      return;
    }
    if (!this.agents.antigravityInstallation()) {
      await this.agents.detectAntigravity();
    }
    const installation = this.agents.antigravityInstallation();
    if (!installation?.healthy) {
      this.showToast(
        installation?.diagnostic ?? this.i18n.t('common.antigravityNotDetected'),
        'attention',
      );
      return;
    }

    const terminalId = createId();
    this.launchingAntigravity.set(true);
    try {
      const launch = await this.agents.prepareAntigravityLaunch({
        terminalId,
        workspaceId: workspace.id,
        workingDirectory,
        model: value.model,
        effort: value.effort,
        continueLast: value.continueLast,
        autoConfirm: value.autoConfirm,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'antigravity',
        name: value.name || undefined,
        command: launch.command,
        model: value.model ?? ANTIGRAVITY_DEFAULT_MODEL,
        workingDirectory,
        autoConfirm: value.autoConfirm,
      });
      this.antigravityLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.armStartupDialogs(terminal.id);
        this.revealCreatedTerminal(terminal.id);
        this.showToast(this.i18n.t('terminal.started', { name: terminal.name }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    } finally {
      this.launchingAntigravity.set(false);
    }
  }

  protected closeAntigravityLaunch(): void {
    this.antigravityLaunchOpen.set(false);
    this.selectedTerminalDirectory.set(null);
  }

  protected async openOpenCodeLaunch(): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = this.state.activeWorkspace()?.projectPath;
    if (!workingDirectory) {
      return;
    }
    this.selectedTerminalDirectory.set(workingDirectory);
    this.refreshAccountsFor('opencode');
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
      this.showToast(
        installation?.diagnostic ?? this.i18n.t('common.openCodeNotDetected'),
        'attention',
      );
      return;
    }

    const terminalId = createId();
    this.launchingOpenCode.set(true);
    try {
      const launch = await this.agents.prepareOpenCodeLaunch({
        terminalId,
        workspaceId: workspace.id,
        model: value.model,
        accountProfileId: value.accountProfileId,
        autoConfirm: value.autoConfirm,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'opencode',
        name: value.name || undefined,
        command: launch.command,
        model: value.model ?? OPENCODE_DEFAULT_MODEL,
        accountProfileId: value.accountProfileId,
        workingDirectory,
        autoConfirm: value.autoConfirm,
      });
      this.openCodeLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.armStartupDialogs(terminal.id);
        this.revealCreatedTerminal(terminal.id);
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

  protected openGrokLaunch(): void {
    this.agentMenuOpen.set(false);
    const workingDirectory = this.state.activeWorkspace()?.projectPath;
    if (!workingDirectory) return;
    this.selectedTerminalDirectory.set(workingDirectory);
    this.refreshAccountsFor('grok');
    this.grokLaunchOpen.set(true);
  }

  protected async launchGrok(value: GrokLaunchDialogValue): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const workingDirectory = this.selectedTerminalDirectory();
    if (!workspace || !workingDirectory || this.launchingGrok()) return;
    if (!this.agents.grokInstallation()) await this.agents.detectGrok();
    const installation = this.agents.grokInstallation();
    if (!installation?.healthy) {
      this.showToast(
        installation?.diagnostic ?? this.i18n.t('common.grokNotDetected'),
        'attention',
      );
      return;
    }

    const terminalId = createId();
    this.launchingGrok.set(true);
    try {
      const newSessionId = value.continueLast ? undefined : createId();
      const launch = await this.agents.prepareGrokLaunch({
        terminalId,
        workspaceId: workspace.id,
        model: value.model,
        accountProfileId: value.accountProfileId,
        newSessionId,
        continueLast: value.continueLast,
        autoConfirm: value.autoConfirm,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'grok',
        name: value.name || undefined,
        command: launch.command,
        model: value.model || 'Grok Build',
        nativeSessionId: newSessionId,
        accountProfileId: value.accountProfileId,
        workingDirectory,
        autoConfirm: value.autoConfirm,
      });
      this.grokLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.revealCreatedTerminal(terminal.id);
        this.showToast(this.i18n.t('terminal.started', { name: terminal.name }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    } finally {
      this.launchingGrok.set(false);
    }
  }

  protected closeGrokLaunch(): void {
    this.grokLaunchOpen.set(false);
    this.selectedTerminalDirectory.set(null);
  }

  protected openPiLaunch(): void {
    this.agentMenuOpen.set(false);
    const workingDirectory = this.state.activeWorkspace()?.projectPath;
    if (!workingDirectory) return;
    this.selectedTerminalDirectory.set(workingDirectory);
    this.refreshAccountsFor('pi');
    this.piLaunchOpen.set(true);
  }

  protected async launchPi(value: PiLaunchDialogValue): Promise<void> {
    const workspace = this.state.activeWorkspace();
    const workingDirectory = this.selectedTerminalDirectory();
    if (!workspace || !workingDirectory || this.launchingPi()) return;
    if (!this.agents.piInstallation()) await this.agents.detectPi();
    const installation = this.agents.piInstallation();
    if (!installation?.healthy) {
      this.showToast(installation?.diagnostic ?? this.i18n.t('common.piNotDetected'), 'attention');
      return;
    }

    const terminalId = createId();
    this.launchingPi.set(true);
    try {
      const launch = await this.agents.preparePiLaunch({
        terminalId,
        workspaceId: workspace.id,
        model: value.model,
        accountProfileId: value.accountProfileId,
        continueLast: value.continueLast,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'pi',
        name: value.name || undefined,
        command: launch.command,
        model: value.model || 'Pi Agent',
        accountProfileId: value.accountProfileId,
        workingDirectory,
      });
      this.piLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.revealCreatedTerminal(terminal.id);
        this.showToast(this.i18n.t('terminal.started', { name: terminal.name }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    } finally {
      this.launchingPi.set(false);
    }
  }

  protected closePiLaunch(): void {
    this.piLaunchOpen.set(false);
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

    const terminalId = createId();
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
        reasoningEffort: value.reasoningEffort,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'codex',
        name: value.name || undefined,
        command: launch.command,
        model:
          value.model ||
          (profile ? profileModel(profile, 'codex') : undefined) ||
          this.i18n.t('terminal.defaultCodexModel'),
        workingDirectory,
        profileId: value.profileId,
        accountProfileId: value.accountProfileId,
        autoConfirm: value.autoConfirm,
      });
      this.codexLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.revealCreatedTerminal(terminal.id);
        this.armStartupDialogs(terminal.id);
        this.showToast(this.i18n.t('terminal.started', { name: terminal.name }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    } finally {
      this.launchingCodex.set(false);
    }
  }

  protected closeCodexLaunch(): void {
    this.codexLaunchOpen.set(false);
    this.selectedTerminalDirectory.set(null);
    this.pendingCommonActionLaunch = null;
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

    const terminalId = createId();
    this.launchingClaude.set(true);
    try {
      const launch = await this.agents.prepareLaunch({
        terminalId,
        workspaceId: workspace.id,
        name: value.name || undefined,
        model: value.model,
        profileId: value.profileId,
        mcpProfileId: value.mcpProfileId,
        accountProfileId: value.accountProfileId,
        autoConfirm: value.autoConfirm,
        context1m: value.context1m,
        effort: value.effort,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'claude',
        name: value.name || undefined,
        command: launch.command,
        model: value.model || (profile ? profileModel(profile, 'claude') : this.i18n.t('terminal.defaultClaudeModel')),
        workingDirectory,
        profileId: value.profileId,
        mcpProfileId: value.mcpProfileId,
        accountProfileId: value.accountProfileId,
        autoConfirm: value.autoConfirm,
      });
      this.claudeLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.armStartupDialogs(terminal.id);
        this.revealCreatedTerminal(terminal.id);
        this.showToast(this.i18n.t('terminal.started', { name: terminal.name }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    } finally {
      this.launchingClaude.set(false);
    }
  }

  protected closeClaudeLaunch(): void {
    this.claudeLaunchOpen.set(false);
    this.selectedTerminalDirectory.set(null);
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
          : agentType === 'pi'
            ? this.launchingPi
            : agentType === 'grok'
              ? this.launchingGrok
              : agentType === 'antigravity'
                ? this.launchingAntigravity
                : this.launchingOpenCode;
    if (!workspace || launching()) {
      return;
    }

    const profile =
      agentType === 'opencode' ||
      agentType === 'grok' ||
      agentType === 'pi' ||
      agentType === 'antigravity'
        ? undefined
        : this.agents.modelProfiles().find((item) => item.id === value.profileId);
    if (profile && needsCredential(profile, agentType === 'claude' ? 'claude' : 'codex')) {
      this.openModelCredentialSettings(profile.id, profile.name);
      return;
    }

    const terminalId = createId();
    const workingDirectory = value.session.projectPath ?? workspace.projectPath;
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
            : agentType === 'pi'
              ? await this.agents.preparePiLaunch({
                  terminalId,
                  workspaceId: workspace.id,
                  sessionId: value.session.nativeSessionId,
                  model: value.model,
                  accountProfileId: value.accountProfileId ?? value.session.accountProfileId,
                })
              : agentType === 'grok'
                ? await this.agents.prepareGrokLaunch({
                    terminalId,
                    workspaceId: workspace.id,
                    sessionId: value.session.nativeSessionId,
                    model: value.model,
                    accountProfileId: value.accountProfileId ?? value.session.accountProfileId,
                    autoConfirm: value.autoConfirm,
                  })
                : agentType === 'antigravity'
                  ? await this.agents.prepareAntigravityLaunch({
                      terminalId,
                      workspaceId: workspace.id,
                      workingDirectory,
                      sessionId: value.session.nativeSessionId,
                      model: value.model,
                      autoConfirm: value.autoConfirm,
                    })
                  : await this.agents.prepareOpenCodeLaunch({
                      terminalId,
                      workspaceId: workspace.id,
                      sessionId: value.session.nativeSessionId,
                      model: value.model,
                      accountProfileId: value.accountProfileId ?? value.session.accountProfileId,
                      autoConfirm: value.autoConfirm,
                    });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: value.session.agentType,
        name: value.session.title,
        command: launch.command,
        model:
          value.model ||
          (profile
            ? profileModel(profile, agentType === 'claude' ? 'claude' : 'codex')
            : undefined) ||
          value.session.modelName ||
          (agentType === 'claude'
            ? 'Claude Sonnet'
            : agentType === 'codex'
              ? this.i18n.t('terminal.defaultCodexModel')
              : agentType === 'pi'
                ? 'Pi Agent'
                : agentType === 'grok'
                  ? 'Grok Build'
                  : agentType === 'antigravity'
                    ? ANTIGRAVITY_DEFAULT_MODEL
                    : OPENCODE_DEFAULT_MODEL),
        nativeSessionId: value.session.nativeSessionId,
        workingDirectory,
        profileId: value.profileId,
        mcpProfileId: agentType === 'claude' ? value.mcpProfileId : undefined,
        accountProfileId: isAccountAgentType(agentType)
          ? (value.accountProfileId ?? value.session.accountProfileId)
          : undefined,
        autoConfirm: value.autoConfirm,
      });
      if (terminal) {
        if (agentType !== 'grok' && agentType !== 'pi') this.armStartupDialogs(terminal.id);
        this.revealCreatedTerminal(terminal.id);
        this.showToast(this.i18n.t('terminal.resuming', { name: value.session.title }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    } finally {
      launching.set(false);
    }
  }

  /**
   * Closing a terminal that has work in progress (a running agent, a turn in flight, an approval
   * prompt or a rate limit reply) throws away that work and the user only knows it happened when
   * the process is gone. The view's × buttons, the tab × and the middle-click close all route
   * through `requestCloseTerminal` first, which closes settled terminals directly and asks before
   * interrupting a launch, an active turn, or a turn waiting for user input.
   */
  protected requestCloseTerminal(terminalId: string, event?: MouseEvent): void {
    const located = this.findTerminal(terminalId);
    if (!located) {
      void this.closeTerminal(terminalId);
      return;
    }
    if (this.isTerminalSettled(located.terminal.status)) {
      void this.closeTerminal(terminalId);
      return;
    }
    const trigger =
      event?.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : document.getElementById(`terminal-tab-${terminalId}`);
    const bounds = trigger?.getBoundingClientRect();
    this.terminalCloseAnchor.set(
      event && (event.clientX !== 0 || event.clientY !== 0)
        ? { x: event.clientX, y: event.clientY }
        : {
            x: bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2,
            y: bounds?.bottom ?? window.innerHeight / 2,
          },
    );
    this.pendingTerminalClose.set(terminalId);
  }

  protected cancelCloseTerminal(): void {
    this.pendingTerminalClose.set(null);
  }

  protected confirmCloseTerminal(terminalId: string): void {
    if (this.closingTerminal()) {
      return;
    }
    this.pendingTerminalClose.set(null);
    this.closingTerminal.set(true);
    void this.closeTerminal(terminalId);
    // Shutdown is serialized per terminal by the gateway. Release the popup guard so another
    // terminal can still be closed while this one is waiting for the backend.
    queueMicrotask(() => this.closingTerminal.set(false));
  }

  /**
   * A completed turn has no work left to interrupt, even if the CLI stays open at its prompt.
   */
  private isTerminalSettled(status: TerminalStatus): boolean {
    return (
      status === 'IDLE' ||
      status === 'COMPLETED' ||
      status === 'STOPPED' ||
      status === 'FAILED' ||
      status === 'DISCONNECTED'
    );
  }

  protected async closeTerminal(terminalId: string): Promise<boolean> {
    if (this.remoteConnection.readOnly()) return false;
    try {
      await this.terminalGateway.close(terminalId);
      this.removeClosedTerminal(terminalId);
      return true;
    } catch (error) {
      // Keep the console and its process handle available for a retry when shutdown failed.
      this.showToast(this.errorMessage(error), 'error');
      return false;
    }
  }

  private removeClosedTerminal(terminalId: string): void {
    this.pendingAccountLogins.delete(terminalId);
    this.loginFeedback.forget(terminalId);
    const workspace = this.state.activeWorkspace();
    if (
      this.terminalFillsLayout() &&
      this.activeTerminalId() === terminalId &&
      workspace?.terminals.length === 1
    ) {
      this.terminalFillsLayout.set(false);
    }
    this.agentStartup.cancel(terminalId);
    this.todos.handleTerminalStatus(terminalId, 'STOPPED');
    this.state.removeTerminal(terminalId);
  }

  /**
   * Brings a terminal the user just asked for onto the screen.
   *
   * Creating one already makes it the active terminal, but the workspace may be showing the task
   * board or the Git view, where no terminal is drawn at all — the new one opened behind whichever
   * view was in front, and nothing said so.
   */
  private revealCreatedTerminal(terminalId: string): void {
    this.workspaceView.set('terminal');
    this.selectTerminal(terminalId);
  }

  protected selectTerminal(terminalId: string): void {
    const workspace = this.state.activeWorkspace();
    if (!workspace) {
      return;
    }
    this.workspaceView.set('terminal');
    if (!this.showOnlyActiveTerminal()) {
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
      for (const [workspaceId, review] of Object.entries(this.commonActions.reviews())) {
        if (review.waiting && review.terminalId === event.terminalId) {
          this.commonActions.updateRecognition(workspaceId, review.requestId, { waiting: false, error: '识别使用的 Agent 已停止或断开，请重新识别。' });
        }
      }
      this.agentStartup.cancel(event.terminalId);
      return;
    }
    // Codex opens idle, while other processes use RUNNING after the PTY spawns.
    // Both must start the startup-dialog/prompt-delivery clocks.
    if (event.status === 'RUNNING' || event.status === 'IDLE') {
      this.agentStartup.markRuntimeStarted(event.terminalId);
    }
  }

  protected async executeTodoTask(taskId: string): Promise<void> {
    await this.loadTodoTranslations();
    const task = this.todos.task(taskId);
    if (!task || this.busyTodoTaskId()) return;
    const prompt = this.initialTodoPrompt(task);
    const reusableTerminalId =
      task.preferredTerminalId ?? (task.executionState === 'failed' ? task.terminalId : undefined);
    if (reusableTerminalId) {
      const located = this.findTerminal(reusableTerminalId);
      if (!located) {
        if (task.attempts === 0) {
          const message = this.i18n.t('taskFlow.error.selectedTerminalClosed');
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
    await this.loadTodoTranslations();
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
        this.showToast(this.i18n.t('taskFlow.toast.feedbackSent', { name: located.terminal.name }));
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
   * afterwards — "Stop and delete" from the card — still hands this the terminal it has to
   * interrupt.
   */
  protected stopTodoTask(taskId: string): void {
    void this.interruptTodoTask(taskId).catch((error: unknown) =>
      this.showToast(this.errorMessage(error), 'attention'),
    );
  }

  private async interruptTodoTask(taskId: string): Promise<void> {
    const task = this.todos.task(taskId);
    const terminalId = task?.terminalId;
    if (!this.todos.stopExecution(taskId) || !task) return;
    if (terminalId) {
      this.agentStartup.cancel(terminalId);
      await this.writeToTerminal(terminalId, AGENT_INTERRUPT_SEQUENCE);
      this.recordInterruptStatus(terminalId);
    }
    this.showToast(this.i18n.t('taskFlow.toast.stopped', { title: task.title }));
  }

  /**
   * Moves a terminal to the status an Esc written straight to its PTY leads to.
   *
   * Claude and Codex report an interrupt late or not at all, so the terminal panel reads the key
   * instead — but only for keys typed into it, which this one was not. The panel's own rule is
   * applied here, so both ways of interrupting end in the same status.
   */
  private recordInterruptStatus(terminalId: string): void {
    const terminal = this.findTerminal(terminalId)?.terminal;
    if (!terminal) return;
    const status = new TerminalInputStatusTracker().statusAfterInput(AGENT_INTERRUPT_SEQUENCE, {
      agentType: terminal.agentType,
      status: terminal.status,
      // Esc is never read as an answer to a dialog, so the screen does not need reading.
      readApprovalOptions: () => [],
    });
    if (status) {
      this.handleTerminalStatus({ terminalId, status });
    }
  }

  /**
   * Picks a stopped run back up in the terminal that still holds its session.
   *
   * The agent is told to carry on rather than restart, because the work it already did is still in
   * front of it — that is the whole point of stopping without discarding the run.
   */
  protected async resumeTodoTask(taskId: string): Promise<void> {
    await this.loadTodoTranslations();
    const task = this.todos.task(taskId);
    if (!task || this.busyTodoTaskId()) return;
    const located = task.terminalId ? this.findTerminal(task.terminalId) : null;
    if (!located) {
      const message = this.i18n.t('taskFlow.error.originalTerminalClosed');
      this.todos.setExecutionError(task.id, message);
      this.showToast(message, 'attention');
      return;
    }
    await this.runTodoInExistingTerminal(task, this.resumeTodoPrompt(task), located, true);
  }

  protected returnTodoTaskToBacklog(taskId: string): void {
    const task = this.todos.task(taskId);
    if (!task || !this.todos.returnToBacklog(taskId)) return;
    this.showToast(this.i18n.t('taskFlow.toast.returnedToBacklog', { title: task.title }));
  }

  /**
   * Hands new instructions to the agent already working on the task.
   *
   * Editing a running task only ever changed the board; the agent kept working from what it was
   * told at the start. This sends the change through the same terminal, so both sides agree.
   */
  protected async amendTodoTask(request: TodoContinuationRequest): Promise<void> {
    await this.loadTodoTranslations();
    if (this.busyTodoTaskId()) return;
    const amended = this.todos.amendExecution(request);
    if (!amended) return;
    const located = amended.terminalId ? this.findTerminal(amended.terminalId) : null;
    if (!located) {
      const message = this.i18n.t('taskFlow.error.amendmentUndelivered');
      this.todos.setExecutionError(amended.id, message);
      this.showToast(message, 'attention');
      return;
    }
    this.busyTodoTaskId.set(amended.id);
    try {
      await this.submitTodoPrompt(
        amended.id,
        located.terminal.id,
        this.amendmentTodoPrompt(amended, request.feedback),
      );
      this.state.updateTerminalStatus(located.terminal.id, 'THINKING');
      this.todos.handleTerminalStatus(located.terminal.id, 'THINKING');
      this.showToast(this.i18n.t('taskFlow.toast.amendmentSent', { name: located.terminal.name }));
    } catch (error) {
      const message = this.errorMessage(error);
      this.todos.setExecutionError(amended.id, message, located.terminal.id);
      this.showToast(message, 'attention');
    } finally {
      this.busyTodoTaskId.set(null);
    }
  }

  protected openTodoTerminal(terminalId: string): void {
    const located = this.findTerminal(terminalId);
    if (!located) {
      this.showToast(this.i18n.t('taskFlow.toast.linkedTerminalClosed'), 'attention');
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
   * The task keeps its native session id, so a routine task that runs again still resumes the same
   * agent session in a fresh terminal.
   */
  protected async closeTodoTerminal(terminalId: string): Promise<void> {
    const located = this.findTerminal(terminalId);
    if (!located) return;
    if (await this.closeTerminal(terminalId))
      this.showToast(this.i18n.t('taskFlow.toast.terminalClosed', { name: located.terminal.name }));
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
    const records = this.activeHandoffRecords();
    if (!records.some((record) => record.id === this.handoffPreview()?.id)) {
      this.handoffPreview.set(null);
      if (records[0]) void this.selectHandoffRecord(records[0]);
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
      const handoff = await this.handoffs.importPackage(this.state.activeWorkspace()?.id);
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

  private async persistHandoff(handoff: HandoffPackage): Promise<HandoffPackage> {
    const saved = await this.handoffs.updatePackage(handoff);
    if (this.handoffPreview()?.id === saved.id) this.handoffPreview.set(saved);
    return saved;
  }

  protected async saveHandoffChanges(handoff: HandoffPackage): Promise<void> {
    if (this.handoffs.busy() || this.handoffSending()) return;
    try {
      await this.persistHandoff(handoff);
      this.showToast(this.i18n.t('handoff.saved'));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async sendHandoff(request: HandoffSendRequest): Promise<void> {
    if (this.handoffs.busy() || this.handoffSending()) return;
    const workspace = this.state.activeWorkspace();
    const terminal = workspace?.terminals.find((candidate) => candidate.id === request.terminalId);
    if (!workspace || !terminal || terminal.agentType === 'shell') {
      this.showToast(this.i18n.t('handoff.targetMissing'), 'attention');
      return;
    }
    try {
      this.handoffSending.set(true);
      const saved = await this.persistHandoff(request.handoff);
      const { continuationPrompt } = await import('./core/models/handoff');
      const prompt = continuationPrompt(saved);
      this.rememberPromptDraft(workspace, terminal, prompt);
      await this.deliverTerminalPrompt(terminal.id, prompt, true);
      this.promptAssets.captureInput(workspace, terminal, '\r');
      this.selectTerminal(terminal.id);
      this.handoffOpen.set(false);
      this.showToast(this.i18n.t('handoff.sent', { name: terminal.name }));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    } finally {
      this.handoffSending.set(false);
    }
  }

  private moveActiveTerminal(direction: -1 | 1): boolean {
    const terminalId = this.activeTerminalId();
    return terminalId !== null && this.state.moveTerminal(terminalId, direction);
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

  /** Closes a terminal on a middle click, as browsers and editors do for their own tabs. */
  protected closeTerminalOnMiddleClick(event: MouseEvent, terminalId: string): void {
    if (event.button !== MIDDLE_MOUSE_BUTTON) {
      return;
    }
    event.preventDefault();
    this.requestCloseTerminal(terminalId, event);
  }

  protected async openProjectDirectory(path: string): Promise<void> {
    try {
      await this.terminalGateway.openDirectory(path);
    } catch (error) {
      this.reportFailure(
        this.i18n.t('terminal.openFailed', { target: path, error: String(error) }),
      );
    }
  }

  /** Everything a tab cannot show at its width: where it runs, and what it responds to. */
  protected terminalTabTitle(terminal: TerminalSession): string {
    const action = this.isTerminalVisible(terminal.id)
      ? this.i18n.t('terminal.activate')
      : this.i18n.t('terminal.showInLayout');
    return [
      `${terminal.name} · ${this.statusLabel(terminal.status)}`,
      ...(terminal.model ? [terminal.model] : []),
      terminal.workingDirectory,
      `${action} · ${this.i18n.t('terminal.tabHint')}`,
    ].join('\n');
  }

  protected isTerminalVisible(terminalId: string): boolean {
    return this.visibleTerminalIds().includes(terminalId);
  }

  protected workbenchTabId(view: WorkspaceView, id: string): string {
    if (view === 'terminal') return 'terminal-tab-' + id;
    if (view === 'preview') return 'content-preview-tab-' + id;
    return 'workspace-tool-tab-' + id;
  }

  protected selectOverflowTab(tab: WorkbenchTab): void {
    this.tabMenuOpen.set(false);
    this.activateWorkbenchTab(tab);
    if (tab.view === 'terminal' || tab.view === 'preview') {
      window.requestAnimationFrame(() => {
        document.getElementById(this.workbenchTabId(tab.view, tab.id))?.focus({ preventScroll: true });
      });
    }
  }

  private activateWorkbenchTab(tab: WorkbenchTab): void {
    if (tab.view === 'terminal') this.selectTerminal(tab.id);
    else if (tab.view === 'preview') this.preview.activate(tab.id);
    else this.selectWorkspaceTool(tab.view);
  }

  protected visibleTerminalLimit(): number {
    return this.showOnlyActiveTerminal()
      ? 1
      : layoutTerminalCapacity(
          this.state.activeWorkspace()?.layout ?? 'single',
          this.gridColumns(),
          this.gridRows(),
        );
  }

  protected toggleTerminalLayoutFill(terminalId: string): void {
    const shouldRestore = this.terminalFillsLayout() && this.activeTerminalId() === terminalId;
    this.selectTerminal(terminalId);
    this.terminalFillsLayout.set(!shouldRestore);
    this.requestTerminalRefit();
  }

  protected toggleTerminalFocus(terminalId: string): void {
    if (this.terminalFocusMode()) {
      this.restoreTerminalFocusMode();
      return;
    }
    this.selectTerminal(terminalId);
    this.terminalFocusMode.set(true);
    this.requestTerminalRefit();
  }

  private restoreTerminalFocusMode(): void {
    this.terminalFocusMode.set(false);
    this.requestTerminalRefit();
  }

  protected async minimizeWindow(): Promise<void> {
    await this.runWindowControl(() => this.windowControls.minimize());
  }

  protected async toggleWindowMaximize(): Promise<void> {
    await this.runWindowControl(() => this.windowControls.toggleMaximize());
    this.requestTerminalRefit();
  }

  protected async closeWindow(): Promise<void> {
    await this.runWindowControl(() => this.windowControls.close());
  }

  /**
   * The window buttons replace the native title bar, so a failure would otherwise look like a
   * dead button — the toast is the only place the user can find out why nothing happened.
   */
  private async runWindowControl(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    }
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
      if (next && this.phoneLayout()) this.workspaceSidebarOpen.set(false);
      this.storePreference('termexo.inspectorOpen', next);
      return next;
    });
  }

  /**
   * Switches to the Git view and, when the inspector hands us a specific change, jumps the
   * diff to that file. A change-less click still flips the view without a selection.
   */
  protected openGitView(change: { path: string } | null | undefined | void): void {
    const path = change?.path;
    this.openWorkspaceTool('git');
    if (path) {
      this.git.selectPath(path);
    }
  }

  protected startSidebarResize(target: SidebarResizeTarget, event: PointerEvent): void {
    if (event.button !== 0 || this.terminalFocusMode()) {
      return;
    }
    event.preventDefault();
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = target === 'workspace'
      ? this.workspaceSidebarWidth()
      : this.inspectorWidth();
    const handle = event.currentTarget as HTMLElement | null;
    handle?.setPointerCapture?.(event.pointerId);
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
  @HostListener('window:pointercancel')
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
    this.phoneLayout.set(width <= PHONE_LAYOUT_MAX_WIDTH);
    this.previousViewportWidth = width;
    this.requestTerminalRefit();
  }

  private requestTerminalRefit(): void {
    this.layoutRevision.update((revision) => revision + 1);
  }

  protected chooseWorkspaceAction(tool: WorkspaceTool): void {
    this.agentMenuOpen.set(false);
    this.openWorkspaceTool(tool);
  }

  private openWorkspaceTool(tool: WorkspaceTool): void {
    const workspaceId = this.workspaceTabScope();
    if (workspaceId === null && tool !== 'sessions') return;
    if (!this.workspaceTools().some((tab) => tab.tool === tool)) {
      this.openedWorkspaceTools.update((tabs) => [...tabs, { workspaceId, tool }]);
    }
    this.selectWorkspaceTool(tool);
  }

  protected selectWorkspaceTool(tool: WorkspaceTool): void {
    this.workspaceView.set(tool);
    window.requestAnimationFrame(() => {
      if (this.workspaceView() !== tool) return;
      document.getElementById(this.workbenchTabId(tool, tool))?.focus({ preventScroll: true });
    });
  }

  protected closeWorkspaceTool(tool: WorkspaceTool): void {
    const tabs = this.workspaceTools();
    const index = tabs.findIndex((tab) => tab.tool === tool);
    if (index < 0) return;
    const closed = tabs[index];
    this.openedWorkspaceTools.update((open) => open.filter((tab) => tab !== closed));
    if (tool === 'common-actions') this.returnToCommonActionReview.set(null);
    if (this.workspaceView() !== tool) return;

    const previous = tabs[index - 1];
    const preview = this.preview.workspaceTabs().at(-1);
    const terminal = this.state.activeTerminal();
    if (previous) this.selectWorkspaceTool(previous.tool);
    else if (preview) this.preview.activate(preview.id);
    else if (terminal) this.selectTerminal(terminal.id);
    else if (tabs[index + 1]) this.selectWorkspaceTool(tabs[index + 1].tool);
    else this.workspaceView.set('terminal');
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
    if (this.remoteConnection.readOnly()) return;
    if (event.key === 'Escape') {
      this.restoreMaximizedView(event);
      return;
    }
    this.runTabShortcut(event);
  }

  private runTabShortcut(event: KeyboardEvent): void {
    const shortcut = workbenchShortcut(event);
    if (!shortcut) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[role="dialog"], [role="menu"]')) return;

    const view = this.workspaceView();
    if (shortcut.action === 'moveTab') {
      if (view === 'terminal' && this.moveActiveTerminal(shortcut.delta)) event.preventDefault();
      return;
    }

    const tabs = this.workbenchTabs();
    if (!tabs.length) return;
    const activeIndex = this.activeWorkbenchTabIndex();
    const selected = shortcut.action === 'selectTab'
      ? tabs[shortcut.index]
      : activeIndex < 0
        ? (shortcut.delta < 0 ? tabs.at(-1) : tabs[0])
        : tabs[(activeIndex + shortcut.delta + tabs.length) % tabs.length];
    if (!selected) return;
    event.preventDefault();
    this.activateWorkbenchTab(selected);
  }

  private restoreMaximizedView(event: KeyboardEvent): void {
    if (!event.shiftKey) {
      return;
    }
    if (this.terminalFocusMode()) {
      event.preventDefault();
      this.restoreTerminalFocusMode();
    } else if (this.terminalFillsLayout()) {
      event.preventDefault();
      this.terminalFillsLayout.set(false);
      this.requestTerminalRefit();
    }
  }

  /** Whether a panel is currently floating over the workspace, which only happens on a phone. */
  protected readonly overlayPanelOpen = computed(
    () =>
      !this.terminalFocusMode() &&
      (this.workspaceSidebarOpen() ||
        (this.inspectorOpen() && this.workspaceView() === 'terminal')),
  );

  /** Dismisses whichever floating panel is open; on a phone they cover the workspace. */
  protected closeOverlayPanels(): void {
    this.workspaceSidebarOpen.set(false);
    this.inspectorOpen.set(false);
  }

  /**
   * The layout a workspace is drawn with, which is its own everywhere but on a phone.
   *
   * The stored layout is left untouched: it is the choice the user made on the desktop, and the
   * window widening again has to bring it back.
   */
  protected renderedLayout(layout: LayoutMode): LayoutMode {
    return this.phoneLayout() ? 'single' : layout;
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

  protected async createWorkspace(value: { name: string; projectPath: string }): Promise<void> {
    if (this.creatingWorkspace() || !value.name.trim() || !value.projectPath.trim()) return;
    this.creatingWorkspace.set(true);
    this.createWorkspaceError.set(null);
    let workspace: Workspace | null;
    try {
      workspace = await this.state.createWorkspace(value.name, value.projectPath);
    } catch (error) {
      this.createWorkspaceError.set(this.errorMessage(error));
      return;
    } finally {
      this.creatingWorkspace.set(false);
    }
    if (!workspace) return;
    this.todos.ensureWorkspace(workspace);
    this.mountWorkspace(workspace.id);
    this.createWorkspaceOpen.set(false);
    this.showToast(this.i18n.t('workspace.created', { name: workspace.name }));
    const agentType = this.pendingOnboardingAgent();
    this.pendingOnboardingAgent.set(null);
    if (agentType) void this.launchAgent(agentType);
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
      this.openedWorkspaceTools.update((tabs) => tabs.filter((tab) => tab.workspaceId !== workspace.id));
      this.todos.deleteWorkspace(workspace.id);
      this.mountWorkspace(this.state.activeWorkspace()?.id);
      this.preferredTerminalIds.update((items) => {
        const next = { ...items };
        delete next[workspace.id];
        return next;
      });
      this.terminalFillsLayout.set(false);
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

      this.openedWorkspaceTools.update((tabs) => tabs.filter((tab) => tab.workspaceId !== sourceWorkspace.id));
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
      this.terminalFillsLayout.set(false);
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
    this.agentMenuOpen.set(false);
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
    // A terminal whose process exited has no prompt to sit at; calling it idle would offer it to
    // the task board as a terminal that can take work.
    this.state.updateTerminalStatus(
      notice.terminalId,
      this.state.hasTerminalExited(notice.terminalId)
        ? 'STOPPED'
        : clearedNoticeStatus(notice.status),
    );
  }

  protected confirmTerminalCompletion(terminalId: string): void {
    const notice = this.globalTerminalNotices().find(
      (item) => item.terminalId === terminalId && item.status === 'COMPLETED',
    );
    if (notice) this.clearTerminalNotice(notice);
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
      this.globalTerminalNotices().filter(isAttentionNotice).map(globalNoticeKey),
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

  protected openUpdates(): void {
    this.openSettings('updates');
  }

  protected saveWorkspaceAppearance(value: WorkspaceAppearanceValue): void {
    if (
      this.state.updateWorkspaceAppearance(
        value.workspaceId,
        value.name,
        value.themeColor,
        value.tags,
        value.icon,
      )
    ) {
      this.editingWorkspaceId.set(null);
      this.showToast(this.i18n.t('workspace.updated', { name: value.name }));
    }
  }

  /** Opens the switcher scoped to one terminal, preselecting its agent type. */
  protected openSingleModelSwitch(terminalId: string): void {
    const terminal = this.state.activeWorkspace()?.terminals.find((item) => item.id === terminalId);
    if (
      !terminal ||
      terminal.agentType === 'shell' ||
      terminal.agentType === 'opencode' ||
      terminal.agentType === 'grok' ||
      terminal.agentType === 'pi' ||
      terminal.agentType === 'antigravity'
    ) {
      return;
    }
    this.modelSwitchTerminalId.set(terminalId);
    this.modelSwitchAgentType.set(terminal.agentType);
    this.modelSwitchOpen.set(true);
  }

  /** Opens the account switcher for any Agent that supports isolated account directories. */
  protected openAccountSwitch(terminalId: string): void {
    const terminal = this.state.activeWorkspace()?.terminals.find((item) => item.id === terminalId);
    if (!terminal || !isAccountAgentType(terminal.agentType)) {
      return;
    }
    this.refreshAccountsFor(terminal.agentType);
    this.accountSwitchTerminalId.set(terminalId);
    this.accountSwitchAgentType.set(terminal.agentType);
    this.accountSwitchOpen.set(true);
  }

  protected closeAccountSwitch(): void {
    this.accountSwitchOpen.set(false);
    this.accountSwitchTerminalId.set(null);
    this.accountSwitchAgentType.set(null);
  }

  /**
   * Restarts one terminal on a different login account.
   *
   * The account reaches the CLI as an environment variable naming its configuration directory,
   * which a live PTY cannot be told about, so the terminal has to be closed and started again.
   * The launch command is built first, so a failure there leaves the running session untouched.
   * Its native session lives in the previous account's directory and cannot be resumed under the
   * new one, which is why the restart deliberately begins a new session.
   */
  protected async switchAccount(accountProfileId: string): Promise<void> {
    const terminal = this.accountSwitchTerminal();
    if (!terminal || !isAccountAgentType(terminal.agentType)) {
      this.closeAccountSwitch();
      return;
    }
    if (this.switchingAccount()) {
      return;
    }
    const agentType = terminal.agentType;
    const agentLaunching =
      agentType === 'claude'
        ? this.launchingClaude
        : agentType === 'codex'
          ? this.launchingCodex
          : agentType === 'opencode'
            ? this.launchingOpenCode
            : agentType === 'pi'
              ? this.launchingPi
              : this.launchingGrok;
    if (agentLaunching()) {
      return;
    }
    // The dialog disables the current account; this also stops a stale event from restarting a
    // terminal onto the account it is already running.
    if (accountProfileId === this.accountSwitchCurrentId()) {
      this.closeAccountSwitch();
      return;
    }

    const workspaceId = this.state.activeWorkspace()?.id;
    const original = { ...terminal };
    this.switchingAccount.set(true);
    agentLaunching.set(true);
    try {
      const explicitNonProfileModel = (model: string, placeholder: string): string | undefined =>
        model && model !== placeholder ? model : undefined;
      const launch =
        agentType === 'claude'
          ? await this.agents.prepareLaunch({
              terminalId: original.id,
              workspaceId,
              model:
                original.profileId === CLI_NATIVE_PROFILE_ID
                  ? explicitCliModel(original.model)
                  : undefined,
              profileId: original.profileId,
              mcpProfileId: original.mcpProfileId,
              accountProfileId,
              autoConfirm: original.autoConfirm,
            })
          : agentType === 'codex'
            ? await this.agents.prepareCodexLaunch({
                terminalId: original.id,
                workspaceId,
                model:
                  original.profileId === CLI_NATIVE_PROFILE_ID
                    ? explicitCliModel(original.model)
                    : undefined,
                profileId: original.profileId,
                accountProfileId,
                autoConfirm: original.autoConfirm,
              })
            : agentType === 'opencode'
              ? await this.agents.prepareOpenCodeLaunch({
                  terminalId: original.id,
                  workspaceId,
                  model: explicitNonProfileModel(original.model, OPENCODE_DEFAULT_MODEL),
                  accountProfileId,
                  autoConfirm: original.autoConfirm,
                })
              : agentType === 'pi'
                ? await this.agents.preparePiLaunch({
                    terminalId: original.id,
                    workspaceId,
                    model: explicitNonProfileModel(original.model, 'Pi Agent'),
                    accountProfileId,
                  })
                : await this.agents.prepareGrokLaunch({
                    terminalId: original.id,
                    workspaceId,
                    model: explicitNonProfileModel(original.model, 'Grok Build'),
                    accountProfileId,
                    autoConfirm: original.autoConfirm,
                  });
      try {
        await this.terminalGateway.close(original.id, true);
      } catch (error) {
        // An exited or crashed terminal has no live PTY left, yet switching it to another
        // account should still start fresh under the newly chosen account.
        if (this.errorMessage(error) !== `terminal ${original.id} was not found`) {
          throw error;
        }
      }
      if (
        !this.state.restartTerminalWithProfile(original.id, launch.command, {
          model: original.model,
          profileId: original.profileId,
          mcpProfileId: original.mcpProfileId,
          accountProfileId,
        })
      ) {
        const agentName =
          agentType === 'claude'
            ? 'Claude'
            : agentType === 'codex'
              ? 'Codex'
              : agentType === 'opencode'
                ? 'OpenCode'
                : agentType === 'pi'
                  ? 'Pi'
                  : 'Grok';
        throw new Error(
          this.i18n.t('restore.terminalMissing', {
            agent: agentName,
            name: original.name,
          }),
        );
      }
      const account = this.agents.accountProfiles().find((item) => item.id === accountProfileId);
      this.closeAccountSwitch();
      this.showToast(
        this.i18n.t('accountSwitch.done', { name: account?.name ?? accountProfileId }),
      );
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    } finally {
      agentLaunching.set(false);
      this.switchingAccount.set(false);
    }
  }

  /** Closes the switcher and clears its scope, so the next open starts as a batch switch. */
  protected closeModelSwitch(): void {
    this.switchSettingsProfile.set('');
    this.modelSwitchOpen.set(false);
    this.modelSwitchTerminalId.set(null);
    this.modelSwitchAgentType.set(null);
  }

  protected openSwitchSettings(profileId: string, choice: string): void {
    this.switchSettingsProfile.set(choice);
    this.openSettings('models', profileId);
  }

  protected async switchModels(value: ModelSwitchValue): Promise<void> {
    const isClaude = value.agent === 'claude';
    if (this.remoteConnection.readOnly() || this.launchingClaude() || this.launchingCodex()) {
      return;
    }

    const workspace = this.state.activeWorkspace();
    const profile = this.agents.modelProfiles().find((item) => item.id === value.profileId);
    const native = value.profileId === CLI_NATIVE_PROFILE_ID;
    // A single-terminal switch reuses this whole flow, narrowed to one target.
    const targetId = this.modelSwitchTerminalId();
    const terminals = (workspace?.terminals ?? []).filter(
      (terminal) =>
        terminal.agentType === value.agent && (targetId === null || terminal.id === targetId),
    );
    if ((!native && (!profile || !profileServes(profile, value.agent))) || terminals.length === 0) {
      this.closeModelSwitch();
      this.showToast(
        this.i18n.t(
          terminals.length === 0
            ? isClaude
              ? 'profile.noClaudeTerminals'
              : 'profile.noCodexTerminals'
            : 'profile.notFound',
        ),
      );
      return;
    }
    if (profile && needsCredential(profile, value.agent)) {
      this.openSwitchSettings(profile.id, profile.id);
      return;
    }
    const requestedModel = profile ? profileModel(profile, value.agent) : value.model;
    const model = requestedModel || this.i18n.t(isClaude ? 'terminal.defaultClaudeModel' : 'terminal.defaultCodexModel');
    const targets = targetId === null ? terminals : terminals.filter(terminal =>
      !matchesRunningModel(terminal.profileId, terminal.model, value.profileId, requestedModel),
    );
    if (!targets.length) {
      this.closeModelSwitch();
      return;
    }

    (isClaude ? this.launchingClaude : this.launchingCodex).set(true);
    try {
      // Build every launch command before touching a PTY. A missing credential or incompatible
      // profile therefore aborts the whole plan with every existing session still running.
      const plans = await Promise.all(
        targets.map(async (terminal) => ({
          original: { ...terminal },
          launch: isClaude
            ? await this.agents.prepareLaunch({
                terminalId: terminal.id,
                workspaceId: workspace?.id,
                profileId: value.profileId,
                model: native ? value.model : undefined,
                mcpProfileId: terminal.mcpProfileId,
                accountProfileId: terminal.accountProfileId,
                autoConfirm: terminal.autoConfirm,
              })
            : await this.agents.prepareCodexLaunch({
                terminalId: terminal.id,
                workspaceId: workspace?.id,
                profileId: value.profileId,
                model: native ? value.model : undefined,
                accountProfileId: terminal.accountProfileId,
                autoConfirm: terminal.autoConfirm,
              }),
        })),
      );
      const closed: typeof plans = [];
      let failure: unknown = null;
      for (const plan of plans) {
        try {
          await this.terminalGateway.close(plan.original.id, true);
          closed.push(plan);
          if (
            !this.state.restartTerminalWithProfile(plan.original.id, plan.launch.command, {
              model,
              profileId: value.profileId,
              mcpProfileId: isClaude ? plan.original.mcpProfileId : undefined,
            })
          ) {
            throw new Error(
              this.i18n.t('restore.terminalMissing', {
                agent: isClaude ? 'Claude' : 'Codex',
                name: plan.original.name,
              }),
            );
          }
        } catch (error) {
          failure = error;
          break;
        }
      }

      let rollbackFailures = 0;
      if (failure) {
        for (const plan of closed.reverse()) {
          try {
            await this.terminalGateway.close(plan.original.id, true).catch(() => undefined);
            if (
              !plan.original.command ||
              !this.state.restartTerminalWithProfile(plan.original.id, plan.original.command, {
                model: plan.original.model,
                profileId: plan.original.profileId,
                mcpProfileId: plan.original.mcpProfileId,
                accountProfileId: plan.original.accountProfileId,
              })
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
              failed: targets.length,
              error: `${this.errorMessage(failure)} · ${
                rollbackFailures === 0
                  ? this.i18n.t('profile.rollbackComplete')
                  : this.i18n.t('profile.rollbackPartial', { count: rollbackFailures })
              }`,
            })
          : this.i18n.t(isClaude ? 'profile.switched' : 'profile.switchedCodex', {
              count: closed.length,
              name: profile?.name || model,
            }),
        failure ? 'attention' : 'success',
      );
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    } finally {
      (isClaude ? this.launchingClaude : this.launchingCodex).set(false);
    }
  }

  private async persistSettingsProfile(
    kind: SettingsProfileKind,
    id: string,
    save: () => Promise<void>,
    message: string,
  ): Promise<void> {
    if (this.profileSaving()) return;
    this.profileSaving.set(true);
    try {
      await save();
      this.profileSaveCompleted.set({ kind, id });
      this.showToast(this.i18n.t(message));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    } finally {
      this.profileSaving.set(false);
    }
  }

  protected async saveModelProfile(input: ModelProfileInput): Promise<void> {
    await this.persistSettingsProfile(
      'models',
      input.id,
      async () => {
        await this.agents.saveModelProfile(input);
        if (this.modelSwitchOpen()) this.switchSettingsProfile.set(input.id);
      },
      'profile.saved',
    );
  }

  /**
   * Takes the user from a launch dialog that found nothing installed to the installer for it.
   *
   * The dialog closes first: it is modal, and leaving it stacked under the settings window would
   * put two dialogs on screen over one decision.
   */
  protected installAgent(agentType: ManagedAgentType): void {
    this.pendingCommonActionLaunch = null;
    this.closeClaudeLaunch();
    this.closeCodexLaunch();
    this.closeOpenCodeLaunch();
    this.closeGrokLaunch();
    this.closePiLaunch();
    this.closeAntigravityLaunch();
    this.settingsInitialCliAgent.set(agentType);
    this.openSettings('cli');
  }

  protected openSettings(tab: SettingsTab = 'models', modelProfileId = ''): void {
    this.settingsInitialTab.set(tab);
    this.settingsInitialModelProfileId.set(modelProfileId);
    // Settings is where sign-in states are read and where login is started from, so the list is
    // brought up to date on the way in rather than showing whatever was cached at startup.
    for (const agentType of ACCOUNT_AGENT_TYPES) {
      this.refreshAccountsFor(agentType);
    }
    this.settingsOpen.set(true);
  }

  protected async saveAccountProfile(input: AccountProfileInput): Promise<void> {
    await this.persistSettingsProfile(
      'accounts',
      input.id,
      async () => {
        await this.agents.saveAccountProfile(input);
      },
      'account.saved',
    );
  }

  protected async deleteAccountProfile(profileId: string): Promise<void> {
    if (this.profileDeleting()) return;
    this.profileDeleting.set(true);
    try {
      await this.agents.deleteAccountProfile(profileId);
      this.showToast(this.i18n.t('account.removed'));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    } finally {
      this.profileDeleting.set(false);
    }
  }

  protected async refreshAccountProfile(profileId: string): Promise<void> {
    try {
      await this.agents.refreshAccountProfile(profileId);
      const profile = this.agents.accountProfiles().find((item) => item.id === profileId);
      this.showToast(profile?.diagnostic ?? this.i18n.t('account.refreshed'));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    }
  }

  protected async loginAccount(input: AccountProfileInput): Promise<void> {
    if (this.profileSaving()) return;
    const workspace = this.state.activeWorkspace();
    if (!workspace) {
      this.showToast(this.i18n.t('account.loginWorkspaceRequired'), 'attention');
      return;
    }
    this.profileSaving.set(true);
    const profileId = input.id;
    const terminalId = createId();
    try {
      await this.agents.saveAccountProfile(input);
      this.profileSaveCompleted.set({ kind: 'accounts', id: profileId });
      const profile = this.agents.accountProfiles().find((item) => item.id === profileId);
      if (!profile) throw new Error(this.i18n.t('account.notFound'));
      await this.openAccountLogin(profile, workspace, terminalId);
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    } finally {
      this.profileSaving.set(false);
    }
  }

  protected async retryAccountLogin(terminalId: string): Promise<void> {
    if (this.profileSaving() || this.remoteConnection.readOnly()) return;
    const workspace = this.state.workspaces().find((item) => item.terminals.some((terminal) => terminal.id === terminalId));
    const terminal = workspace?.terminals.find((item) => item.id === terminalId);
    if (!workspace || !terminal?.accountLogin || !terminal.accountProfileId) return;
    const profile = this.agents.accountProfiles().find((item) => item.id === terminal.accountProfileId);
    if (!profile) { this.showToast(this.i18n.t('account.notFound'), 'error'); return; }
    this.profileSaving.set(true);
    this.loginFeedback.setPhase(terminalId, 'restarting');
    try {
      await this.openAccountLogin(profile, workspace, createId(), terminalId);
    } catch (error) {
      this.loginFeedback.setPhase(terminalId, 'closed');
      this.showToast(this.errorMessage(error), 'error');
    } finally {
      this.profileSaving.set(false);
    }
  }

  private async openAccountLogin(profile: AccountProfile, workspace: Workspace, terminalId: string, previousId?: string): Promise<void> {
    const launch = await this.agents.prepareAccountLogin({ terminalId, workspaceId: workspace.id, accountProfileId: profile.id });
    // Only one live attempt per profile. Other accounts retain their own terminal and feedback.
    const replaced = new Set(this.state.workspaces().flatMap((item) => item.terminals)
      .filter((item) => item.accountLogin && item.accountProfileId === profile.id).map((item) => item.id));
    if (previousId) replaced.add(previousId);
    for (const id of replaced) {
      this.pendingAccountLogins.delete(id);
      try {
        await this.terminalGateway.close(id);
      } catch (error) {
        // A restored login tab may outlive its PTY. It can still start a fresh attempt.
        if (this.errorMessage(error) !== `terminal ${id} was not found`) throw error;
      }
      this.loginFeedback.setPhase(id, 'closed');
    }
    const terminal = this.state.createTerminal({
      id: terminalId, agentType: profile.agentType,
      name: this.i18n.t('account.loginName', { name: profile.name }),
      command: launch.command, accountLogin: true, accountProfileId: profile.id,
      model: this.i18n.t('account.loginModel'), workingDirectory: workspace.projectPath,
    }, workspace.id);
    if (!terminal) throw new Error(this.i18n.t('account.loginWorkspaceRequired'));
    this.loginFeedback.begin(terminalId, this.agents.accountProfiles().find((item) => item.id === profile.id) ?? profile);
    this.settingsOpen.set(false);
    for (const id of replaced) this.removeClosedTerminal(id);
    this.revealCreatedTerminal(terminal.id);
    this.showToast(this.i18n.t('account.loginOpened', { name: profile.name }));
    void this.watchAccountLogin(profile.id, terminalId);
  }

  private async refreshAccountAfterLogin(profileId: string, terminalId: string, successfulExit: boolean): Promise<void> {
    try {
      await this.agents.refreshAccountProfile(profileId);
      // A replaced/closed terminal must never update its successor's feedback.
      const feedback = this.loginFeedback.get(terminalId);
      if (!feedback) return;
      if (feedback.phase === 'success') return;
      const profile = this.agents.accountProfiles().find((item) => item.id === profileId);
      if (successfulExit && this.loginFeedback.confirm(terminalId, !!profile?.authenticated, true)) {
        this.showToast(this.i18n.t('account.loginSucceeded', { name: profile!.name }), 'success');
      } else if (feedback.phase !== 'rejected') {
        this.loginFeedback.setPhase(terminalId, 'closed');
      }
    } catch {
      const phase = this.loginFeedback.get(terminalId)?.phase;
      if (phase && phase !== 'rejected' && phase !== 'success') {
        this.loginFeedback.setPhase(terminalId, 'closed');
      }
    }
  }

  private async watchAccountLogin(profileId: string, terminalId: string): Promise<void> {
    this.pendingAccountLogins.set(terminalId, profileId);
    const deadline = Date.now() + ACCOUNT_LOGIN_POLL_TIMEOUT_MS;
    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, ACCOUNT_LOGIN_POLL_INTERVAL_MS));
        if (this.pendingAccountLogins.get(terminalId) !== profileId) return;
        try { await this.agents.refreshAccountProfile(profileId); } catch { continue; }
        if (this.pendingAccountLogins.get(terminalId) !== profileId) return;
        const profile = this.agents.accountProfiles().find((item) => item.id === profileId);
        if (this.loginFeedback.confirm(terminalId, !!profile?.authenticated)) {
          this.showToast(this.i18n.t('account.loginSucceeded', { name: profile!.name }), 'success');
          return;
        }
      }
      if (this.pendingAccountLogins.get(terminalId) === profileId && this.loginFeedback.get(terminalId)?.phase !== 'rejected') {
        this.loginFeedback.setPhase(terminalId, 'timeout');
      }
    } finally {
      if (this.pendingAccountLogins.get(terminalId) === profileId) this.pendingAccountLogins.delete(terminalId);
    }
  }

  protected async copyAccountConfiguration(request: {
    sourceId: string;
    targetId: string;
  }): Promise<void> {
    try {
      const copied = await this.agents.copyAccountConfiguration(request.sourceId, request.targetId);
      this.showToast(
        copied.length
          ? this.i18n.t('settings.copyConfigDone', { items: copied.join('、') })
          : this.i18n.t('settings.copyConfigEmpty'),
        copied.length ? 'success' : 'attention',
      );
    } catch (error) {
      this.showToast(this.errorMessage(error), 'attention');
    }
  }

  protected async deleteModelProfile(profileId: string): Promise<void> {
    if (this.profileDeleting()) return;
    this.profileDeleting.set(true);
    try {
      await this.agents.deleteModelProfile(profileId);
      this.showToast(this.i18n.t('profile.deleted'));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    } finally {
      this.profileDeleting.set(false);
    }
  }

  protected async saveMcpProfile(input: McpProfileInput): Promise<void> {
    await this.persistSettingsProfile(
      'mcp',
      input.id,
      async () => {
        await this.agents.saveMcpProfile(input);
      },
      'mcp.saved',
    );
  }

  protected async deleteMcpProfile(profileId: string): Promise<void> {
    if (this.profileDeleting()) return;
    this.profileDeleting.set(true);
    try {
      await this.agents.deleteMcpProfile(profileId);
      this.showToast(this.i18n.t('mcp.deleted'));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    } finally {
      this.profileDeleting.set(false);
    }
  }

  protected async saveNetworkProfile(input: NetworkProfileInput): Promise<void> {
    await this.persistSettingsProfile(
      'network',
      input.id,
      async () => {
        await this.agents.saveNetworkProfile(input);
        this.networkTestResult.set(null);
      },
      'network.saved',
    );
  }

  protected async deleteNetworkProfile(profileId: string): Promise<void> {
    if (this.profileDeleting()) return;
    this.profileDeleting.set(true);
    try {
      await this.agents.deleteNetworkProfile(profileId);
      this.networkTestResult.set(null);
      this.showToast(this.i18n.t('network.deleted'));
    } catch (error) {
      this.showToast(this.errorMessage(error), 'error');
    } finally {
      this.profileDeleting.set(false);
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
        id: createId(),
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

  protected async detectAgentInstallations(): Promise<void> {
    await Promise.all([
      this.agents.detectClaude(),
      this.agents.detectCodex(),
      this.agents.detectOpenCode(),
      this.agents.detectGrok(),
      this.agents.detectPi(),
      this.agents.detectAntigravity(),
    ]);
    this.showToast(this.i18n.t('agent.detectionComplete'));
  }

  /**
   * Shows a failure a child has already put into words, such as a terminal link that would not
   * open or full screen the browser refused, where it cannot disturb what an agent draws.
   */
  protected reportFailure(message: string): void {
    this.showToast(message, 'attention');
  }

  /**
   * Surfaces a short message in the bottom-right toast region.
   *
   * Defaults to `success` for the explicit `showToast(...)` call sites and the legacy single-arg
   * usage, which were every one an "operation completed" notice; failures must opt into `error`
   * (or `attention` when the failure is recoverable and the user has something else to do). The
   * tone also drives how long the message stays on screen — errors do not auto-dismiss so the user
   * can read the diagnosis before the action retries.
   */
  private showToast(
    message: string,
    tone: ToastTone = 'success',
    action?: { label: string; run: () => void },
  ): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.toastTone.set(tone);
    this.toastMessage.set(message);
    this.toastAction.set(action ?? null);
    if (tone === 'error') {
      // Errors wait for explicit dismissal. The `CloseToastRequested` output on the region clears
      // the message; nothing else auto-fires.
      return;
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastMessage.set(null);
      this.toastAction.set(null);
      this.toastTimer = null;
    }, action ? 9_000 : 2_400);
  }

  protected closeToast(): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.toastMessage.set(null);
    this.toastAction.set(null);
  }

  protected runToastAction(): void {
    const action = this.toastAction();
    this.closeToast();
    action?.run();
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
    // OpenCode, Grok Build, Pi and Antigravity resolve their own models and credentials.
    const isOpenCode = task.agentType === 'opencode';
    const isGrok = task.agentType === 'grok';
    const isPi = task.agentType === 'pi';
    const isAntigravity = task.agentType === 'antigravity';
    const usesOwnModel = isOpenCode || isGrok || isPi || isAntigravity;
    const profile = this.agents.modelProfiles().find((item) => item.id === task.profileId);
    if (!workspace || workspace.id !== task.workspaceId || !workingDirectory) {
      const message = this.i18n.t('taskFlow.error.workingDirectoryMissing');
      this.todos.setExecutionError(task.id, message);
      this.showToast(message, 'attention');
      return;
    }
    if (!usesOwnModel && !profile) {
      const message = this.i18n.t('taskFlow.error.modelProfileMissing');
      this.todos.setExecutionError(task.id, message);
      this.showToast(message, 'attention');
      return;
    }
    if (profile && !usesOwnModel && needsCredential(profile, task.agentType as AgentProtocol)) {
      this.openModelCredentialSettings(profile.id, profile.name);
      this.todos.setExecutionError(
        task.id,
        this.i18n.t('taskFlow.error.credentialMissing', { name: profile.name }),
      );
      return;
    }

    // A task carries no account of its own until it has resumed a native session, while the
    // backend silently falls back to the agent's default account. Resolving it here keeps the
    // terminal record honest about the subscription it spends, which is what the inspector
    // matches provider allowances against. These CLIs have no Termexo account profile.
    const accountProfileId = usesOwnModel
      ? undefined
      : resolveAccountProfileId(
          this.agents.accountProfiles(),
          task.agentType as AgentProtocol,
          task.accountProfileId,
        );

    this.busyTodoTaskId.set(task.id);
    const terminalId = createId();
    const nativeSessionId = isGrok ? (sessionId ?? createId()) : sessionId;
    try {
      await this.assertTodoAgentAvailable(task.agentType);
      const reclaim: BackgroundReclaim =
        task.agentType === 'claude'
          ? await this.reclaimBackgroundSession(sessionId)
          : { proceed: true, forkSession: false };
      if (!reclaim.proceed) {
        return;
      }
      const launch = isOpenCode
        ? await this.agents.prepareOpenCodeLaunch({
            terminalId,
            workspaceId: workspace.id,
            sessionId,
            model: task.modelName || undefined,
          })
        : isPi
          ? await this.agents.preparePiLaunch({
              terminalId,
              workspaceId: workspace.id,
              sessionId,
              model: task.modelName || undefined,
            })
          : isGrok
            ? await this.agents.prepareGrokLaunch({
                terminalId,
                workspaceId: workspace.id,
                sessionId,
                newSessionId: sessionId ? undefined : nativeSessionId,
                model: task.modelName || undefined,
              })
            : isAntigravity
              ? await this.agents.prepareAntigravityLaunch({
                  terminalId,
                  workspaceId: workspace.id,
                  workingDirectory,
                  sessionId,
                  model: task.modelName || undefined,
                })
              : task.agentType === 'codex'
                ? await this.agents.prepareCodexLaunch({
                    terminalId,
                    workspaceId: workspace.id,
                    sessionId,
                    model: profileModel(profile!, 'codex'),
                    profileId: profile!.id,
                    accountProfileId,
                  })
                : await this.agents.prepareLaunch({
                    terminalId,
                    workspaceId: workspace.id,
                    sessionId,
                    profileId: profile!.id,
                    accountProfileId,
                    forkSession: reclaim.forkSession,
                    attachShortId: reclaim.attachShortId,
                  });
      const terminal = this.state.createTerminal(
        {
          id: terminalId,
          agentType: task.agentType,
          name: this.i18n.t('taskFlow.terminalName', { title: task.title }),
          command: launch.command,
          model: usesOwnModel
            ? task.modelName ||
              (isPi
                ? 'Pi Agent'
                : isGrok
                  ? 'Grok Build'
                  : isAntigravity
                    ? ANTIGRAVITY_DEFAULT_MODEL
                    : OPENCODE_DEFAULT_MODEL)
            : profileModel(profile!, task.agentType as AgentProtocol),
          nativeSessionId,
          workingDirectory,
          profileId: profile?.id,
          accountProfileId,
        },
        workspace.id,
      );
      if (!terminal) {
        throw new Error(this.i18n.t('taskFlow.error.workspaceClosed'));
      }
      const started = this.todos.beginExecution(
        task.id,
        { terminalId, nativeSessionId, accountProfileId },
        continuation,
      );
      if (!started) {
        throw new Error(this.i18n.t('taskFlow.error.taskMissing'));
      }
      this.armTodoPrompt(terminalId, task.id, prompt);
      this.mountWorkspace(workspace.id);
      this.showToast(
        sessionId
          ? this.i18n.t('taskFlow.toast.terminalCreatedResuming', { title: task.title })
          : this.i18n.t('taskFlow.toast.terminalCreated', { name: terminal.name }),
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
    let unavailableReasonKey = '';
    if (located.workspace.id !== task.workspaceId) {
      unavailableReasonKey = 'taskFlow.error.terminalOutsideWorkspace';
    } else if (!isReusableTodoTerminal(terminal)) {
      unavailableReasonKey = 'taskFlow.error.terminalUnavailable';
    } else if (this.agentStartup.awaitingTerminalIds().includes(terminal.id)) {
      unavailableReasonKey = 'taskFlow.error.terminalStarting';
    } else if (terminal.agentType !== task.agentType) {
      unavailableReasonKey = 'taskFlow.error.agentTypeMismatch';
    } else if (terminalIsOccupied) {
      unavailableReasonKey = 'taskFlow.error.terminalBusy';
    }
    if (unavailableReasonKey) {
      const message = this.i18n.t(unavailableReasonKey);
      this.todos.setExecutionError(task.id, message);
      this.showToast(message, 'attention');
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
      this.showToast(this.i18n.t('taskFlow.toast.taskSent', { name: terminal.name }));
    } catch (error) {
      const message = this.errorMessage(error);
      this.todos.setExecutionError(task.id, message, terminal.id);
      this.showToast(message, 'attention');
    } finally {
      this.busyTodoTaskId.set(null);
    }
  }

  private async assertTodoAgentAvailable(agentType: TodoTask['agentType']): Promise<void> {
    if (!hasBackend()) return;
    if (agentType === 'claude') {
      if (!this.agents.installation()) await this.agents.detectClaude();
      const installation = this.agents.installation();
      if (!installation?.healthy) {
        throw new Error(installation?.diagnostic ?? this.i18n.t('common.claudeNotDetected'));
      }
      return;
    }
    if (agentType === 'opencode') {
      if (!this.agents.openCodeInstallation()) await this.agents.detectOpenCode();
      const installation = this.agents.openCodeInstallation();
      if (!installation?.healthy) {
        throw new Error(installation?.diagnostic ?? this.i18n.t('common.openCodeNotDetected'));
      }
      return;
    }
    if (agentType === 'pi') {
      if (!this.agents.piInstallation()) await this.agents.detectPi();
      const installation = this.agents.piInstallation();
      if (!installation?.healthy)
        throw new Error(installation?.diagnostic ?? this.i18n.t('common.piNotDetected'));
      return;
    }
    if (agentType === 'grok') {
      if (!this.agents.grokInstallation()) await this.agents.detectGrok();
      const installation = this.agents.grokInstallation();
      if (!installation?.healthy) {
        throw new Error(installation?.diagnostic ?? this.i18n.t('common.grokNotDetected'));
      }
      return;
    }
    if (agentType === 'antigravity') {
      if (!this.agents.antigravityInstallation()) await this.agents.detectAntigravity();
      const installation = this.agents.antigravityInstallation();
      if (!installation?.healthy) {
        throw new Error(installation?.diagnostic ?? this.i18n.t('common.antigravityNotDetected'));
      }
      return;
    }
    if (!this.agents.codexInstallation()) await this.agents.detectCodex();
    const installation = this.agents.codexInstallation();
    if (!installation?.healthy) {
      throw new Error(installation?.diagnostic ?? this.i18n.t('common.codexNotDetected'));
    }
  }

  /**
   * Claude Code and Codex CLI both open on a folder-trust dialog, so the prompt has to wait until
   * the startup dialogs are answered and the agent's input is actually listening. Claude's screen
   * preselects "No, exit", so answering it means moving the highlight onto the option that grants
   * trust rather than accepting whatever is highlighted.
   */
  /**
   * Answers the dialogs an agent opens on, for a terminal that carries no prompt to send.
   *
   * Claude and Codex both start on a folder-trust screen, and Claude's preselects "No, exit".
   * That decision is recorded per config directory, so a workspace already trusted under one
   * account is asked about again under another — which looks like the agent refusing to start
   * with the account that was picked. Task dispatch has always answered these; a plain launch
   * needs the same, only without a prompt to submit afterwards.
   */
  private armStartupDialogs(terminalId: string): void {
    const located = this.findTerminal(terminalId);
    const resumeRecognition = this.pendingCommonActionLaunch === located?.workspace.id;
    const requestId = resumeRecognition
      ? this.commonActions.beginRecognition(located!.workspace.id, terminalId, 'starting')
      : undefined;
    if (resumeRecognition) {
      this.pendingCommonActionLaunch = null;
      this.openWorkspaceTool('common-actions');
    }
    this.agentStartup.arm(terminalId, {
      confirm: (writes) => this.writeTerminalSequence(terminalId, writes),
      submit: requestId
        ? () => this.submitCommonActionRecognition(located!.workspace.id, terminalId, requestId)
        : async () => undefined,
      onFailed: (message) => {
        if (requestId) this.commonActions.updateRecognition(located!.workspace.id, requestId, { waiting: false, error: message });
      },
    });
    if (['RUNNING', 'IDLE'].includes(this.findTerminal(terminalId)?.terminal.status ?? '')) {
      this.agentStartup.markRuntimeStarted(terminalId);
    }
  }

  private armTodoPrompt(terminalId: string, taskId: string, prompt: string): void {
    this.agentStartup.arm(terminalId, {
      confirm: (writes) => this.writeTerminalSequence(terminalId, writes),
      submit: () => this.submitTodoPrompt(taskId, terminalId, prompt),
      onFailed: (message) => {
        this.todos.setExecutionError(taskId, message, terminalId);
        this.showToast(this.i18n.t('taskFlow.toast.sendFailed', { error: message }), 'attention');
      },
    });
    // An already-started process may have emitted RUNNING or Codex's IDLE before this was armed.
    if (['RUNNING', 'IDLE'].includes(this.findTerminal(terminalId)?.terminal.status ?? '')) {
      this.agentStartup.markRuntimeStarted(terminalId);
    }
  }

  private async submitTodoPrompt(
    taskId: string,
    terminalId: string,
    prompt: string,
  ): Promise<void> {
    if (!this.todos.markPromptSending(taskId, terminalId)) {
      throw new Error(this.i18n.t('taskFlow.error.taskReassigned'));
    }
    const located = this.findTerminal(terminalId);
    if (!located) {
      throw new Error(this.i18n.t('taskFlow.error.terminalClosedBeforeSend'));
    }
    this.rememberPromptDraft(located.workspace, located.terminal, prompt);
    await this.deliverTerminalPrompt(terminalId, prompt, true);
    this.promptAssets.captureInput(located.workspace, located.terminal, '\r');
    if (!this.todos.markPromptDelivered(taskId, terminalId)) {
      throw new Error(this.i18n.t('taskFlow.error.deliveryUnconfirmed'));
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

  private deliverTerminalPrompt(
    terminalId: string,
    content: string,
    submit: boolean,
  ): Promise<void> {
    return this.writeTerminalSequence(terminalId, terminalPromptWrites(content, submit));
  }

  /** @see terminalPromptWrites for why the keys cannot travel in a single write. */
  private async writeTerminalSequence(
    terminalId: string,
    writes: readonly string[],
  ): Promise<void> {
    for (const [index, data] of writes.entries()) {
      if (index > 0) {
        await this.settleTerminalInput(
          writes[index - 1].startsWith('\x1b[200~')
            ? TERMINAL_PASTE_SETTLE_MS
            : TERMINAL_INPUT_SETTLE_MS,
        );
      }
      await this.writeToTerminal(terminalId, data);
    }
  }

  private settleTerminalInput(delay = TERMINAL_INPUT_SETTLE_MS): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, delay));
  }

  private async writeToTerminal(terminalId: string, data: string): Promise<void> {
    const located = this.findTerminal(terminalId);
    if (!located) {
      throw new Error(this.i18n.t('taskFlow.error.terminalClosedBeforeSend'));
    }
    await this.terminalGateway.write(located.terminal, data);
  }

  private initialTodoPrompt(task: TodoTask): string {
    const project = this.todos.project(task.projectId);
    return [
      this.i18n.t('taskFlow.prompt.initialIntro'),
      '',
      this.i18n.t('taskFlow.prompt.task', { title: task.title }),
      this.i18n.t('taskFlow.prompt.project', {
        name: project?.name ?? this.i18n.t('taskFlow.prompt.currentProject'),
      }),
      this.i18n.t('taskFlow.prompt.workingDirectory', {
        path: todoWorkingDirectory(task, project),
      }),
      task.description
        ? this.i18n.t('taskFlow.prompt.description', { description: task.description })
        : '',
      task.acceptanceCriteria
        ? this.i18n.t('taskFlow.prompt.acceptanceCriteria', { criteria: task.acceptanceCriteria })
        : '',
      '',
      this.i18n.t('taskFlow.prompt.initialClosing'),
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  /** What a run that was stopped by hand is told when the user picks it back up. */
  private resumeTodoPrompt(task: TodoTask): string {
    return [
      this.i18n.t('taskFlow.prompt.resumeIntro'),
      '',
      this.i18n.t('taskFlow.prompt.task', { title: task.title }),
      task.description
        ? this.i18n.t('taskFlow.prompt.description', { description: task.description })
        : '',
      task.acceptanceCriteria
        ? this.i18n.t('taskFlow.prompt.acceptanceCriteria', { criteria: task.acceptanceCriteria })
        : '',
      '',
      this.i18n.t('taskFlow.prompt.resumeClosing'),
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  /** What the agent hears when the task it is working on gains new requirements. */
  private amendmentTodoPrompt(task: TodoTask, instruction: string): string {
    return [
      this.i18n.t('taskFlow.prompt.amendmentIntro'),
      '',
      this.i18n.t('taskFlow.prompt.task', { title: task.title }),
      this.i18n.t('taskFlow.prompt.instruction', { instruction: instruction.trim() }),
      task.description
        ? this.i18n.t('taskFlow.prompt.updatedDescription', { description: task.description })
        : '',
      task.acceptanceCriteria
        ? this.i18n.t('taskFlow.prompt.updatedAcceptanceCriteria', {
            criteria: task.acceptanceCriteria,
          })
        : '',
      '',
      this.i18n.t('taskFlow.prompt.amendmentClosing'),
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private continuationTodoPrompt(task: TodoTask, feedback: string): string {
    return [
      this.i18n.t('taskFlow.prompt.rejectionIntro'),
      '',
      this.i18n.t('taskFlow.prompt.task', { title: task.title }),
      this.i18n.t('taskFlow.prompt.feedback', { feedback: feedback.trim() }),
      task.description
        ? this.i18n.t('taskFlow.prompt.updatedDescription', { description: task.description })
        : '',
      task.acceptanceCriteria
        ? this.i18n.t('taskFlow.prompt.updatedAcceptanceCriteria', {
            criteria: task.acceptanceCriteria,
          })
        : '',
      '',
      this.i18n.t('taskFlow.prompt.rejectionClosing'),
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

  protected async changeLaunchDirectory(): Promise<void> {
    const selected = await this.selectTerminalDirectory();
    if (selected) this.selectedTerminalDirectory.set(selected);
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
    this.closeModelSwitch();
    this.selectedTerminalDirectory.set(null);
    this.openSettings('models', profileId);
    this.showToast(this.i18n.t('profile.credentialRequired', { name: profileName }), 'attention');
  }

  /**
   * Registers the task-flow wording, loading it on demand to keep it out of the initial bundle.
   *
   * The load is shared by every caller. A failed load is forgotten so the next task action retries
   * it instead of failing forever on a chunk that could not be fetched once.
   */
  private loadTodoTranslations(): Promise<void> {
    this.todoTranslations ??= import('./core/i18n/todo.i18n').then(
      ({ registerTodoTranslations }) => registerTodoTranslations(),
      (error: unknown) => {
        this.todoTranslations = undefined;
        throw error;
      },
    );
    return this.todoTranslations;
  }

  private async initialize(): Promise<void> {
    // Remote views render the desktop's terminal grid, which their own window may be too narrow
    // for, so styling needs to know which kind of client this is.
    document.documentElement.dataset['runtime'] = runtimeMode();
    if (runtimeMode() !== 'desktop') {
      // Loaded on demand to keep it out of the desktop bundle. It tracks for the life of the page,
      // which is the life of this root component, so there is nothing to stop.
      void import('./core/services/visual-viewport').then(({ trackVisualViewport }) =>
        trackVisualViewport(document.documentElement),
      );
    }
    // Started now so the task-flow wording is in place before anyone opens the board; the task
    // actions still await it, because a prompt must never reach an agent as raw keys.
    void this.loadTodoTranslations();
    await this.state.initialize();
    if (this.remoteConnection.readOnly()) {
      this.workspacesLoaded.set(true);
      return;
    }
    await this.todos.initialize(this.state.workspaces());
    this.workspacesLoaded.set(true);
    this.todos.reconcileTerminals(this.state.workspaces());
    await Promise.all([
      this.agents.initialize(),
      this.promptAssets.initialize(),
      this.handoffs.initialize(),
    ]);
    await this.refreshRestoredClaudeLaunches();
    await this.refreshRestoredCodexLaunches();
    await this.refreshRestoredOpenCodeLaunches();
    await this.refreshRestoredNativeModelLaunches('grok');
    await this.refreshRestoredNativeModelLaunches('pi');
    await this.refreshRestoredNativeModelLaunches('antigravity');
    this.mountWorkspace(this.state.activeWorkspace()?.id);
    const recoveredDraft = this.state.activeTerminal()
      ? this.promptAssets.draftForTerminal(this.state.activeTerminal()!.id)
      : undefined;
    if (recoveredDraft) {
      this.showToast(this.i18n.t('prompt.recovered'));
    }
    void this.notifyWhenUpdateAvailable();
    if (runtimeMode() === 'desktop') {
      const { ThirdPartyNotificationsService } =
        await import('./core/services/third-party-notifications.service');
      try {
        await this.injector.get(ThirdPartyNotificationsService).initialize();
      } catch (error) {
        this.showToast('第三方通知总开关读取失败：' + String(error), 'attention');
      }
      const { WechatNotificationsService } =
        await import('./core/services/wechat-notifications.service');
      const wechat = this.injector.get(WechatNotificationsService);
      try {
        await wechat.initialize();
      } catch (error) {
        wechat.error.set(String(error));
      }
      effect(
        () => {
          wechat.observe(this.state.workspaces(), this.todos.snapshots(), this.agents.events());
        },
        { injector: this.injector },
      );
      let previousWechatError = '';
      effect(
        () => {
          const error = wechat.error();
          if (error && error !== previousWechatError)
            this.showToast('微信通知未确认发送：' + error, 'attention');
          previousWechatError = error;
        },
        { injector: this.injector },
      );
      const { McpDesktopService, mcpPreferenceActions } =
        await import('./core/services/mcp-desktop.service');
      await this.injector.get(McpDesktopService).start({
        terminalCreated: (workspaceId, terminalId) => {
          this.selectWorkspace(workspaceId);
          this.revealCreatedTerminal(terminalId);
        },
        terminalClosed: (terminalId) => this.removeClosedTerminal(terminalId),
        selectTaskWorkspace: (workspaceId) => this.selectWorkspace(workspaceId),
        taskLaunchBusy: () => !!this.busyTodoTaskId(),
        executeTask: (taskId) => this.executeTodoTask(taskId),
        resumeTask: (taskId) => this.resumeTodoTask(taskId),
        stopTask: (taskId) => this.interruptTodoTask(taskId),
        ...mcpPreferenceActions({
          i18n: this.i18n,
          terminalFontSize: this.terminalFontSize,
          terminalFontName: this.terminalFontName,
          inspectorOpen: this.inspectorOpen,
          workspaceSidebarOpen: this.workspaceSidebarOpen,
        }),
      });
    }
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
    this.showToast(title, 'attention', {
      label: this.i18n.t('update.view'),
      run: () => this.openUpdates(),
    });
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
    const restoredClaudeTerminals = this.state.workspaces().flatMap((workspace) =>
      workspace.terminals
        .filter((terminal) => terminal.agentType === 'claude')
        // A terminal still running was adopted rather than restarted, and its launch is the
        // one already in flight. Regenerating it would ask the CLI to hand over a session its
        // own live process is holding, which is what raised the reclaim prompt on every reload.
        .filter((terminal) => !this.state.isAdoptedTerminal(terminal.id))
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
        profile: terminal.profileId === CLI_NATIVE_PROFILE_ID ? undefined :
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
        if (!profile && terminal.profileId !== CLI_NATIVE_PROFILE_ID) {
          throw new Error(this.i18n.t('restore.noModelProfile', { name: terminal.name }));
        }
        if (profile && needsCredential(profile, 'claude')) {
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
          profileId: terminal.profileId === CLI_NATIVE_PROFILE_ID ? CLI_NATIVE_PROFILE_ID : profile!.id,
          model: terminal.profileId === CLI_NATIVE_PROFILE_ID ? explicitCliModel(terminal.model) : undefined,
          mcpProfileId: terminal.mcpProfileId,
          accountProfileId: terminal.accountProfileId,
          autoConfirm: terminal.autoConfirm,
          forkSession: Boolean(blocked) && reclaim.resolution === 'fork',
          attachShortId: blocked && reclaim.resolution === 'attach' ? blocked.shortId : undefined,
        });
        if (
          !this.state.updateRestoredTerminalLaunch(terminal.id, launch.command, {
            profileId: terminal.profileId === CLI_NATIVE_PROFILE_ID ? CLI_NATIVE_PROFILE_ID : profile!.id,
            model: terminal.profileId === CLI_NATIVE_PROFILE_ID ? terminal.model : profileModel(profile!, 'claude'),
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
    const restoredCodexTerminals = this.state.workspaces().flatMap((workspace) =>
      workspace.terminals
        .filter((terminal) => terminal.agentType === 'codex')
        // A terminal still running was adopted rather than restarted, and its launch is the
        // one already in flight. Regenerating it would ask the CLI to hand over a session its
        // own live process is holding, which is what raised the reclaim prompt on every reload.
        .filter((terminal) => !this.state.isAdoptedTerminal(terminal.id))
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
          profileId: terminal.profileId === CLI_NATIVE_PROFILE_ID ? CLI_NATIVE_PROFILE_ID : profile?.id,
          model:
            terminal.model &&
            !terminal.model.includes('默认模型') &&
            !terminal.model.toLowerCase().includes('default model')
              ? terminal.model
              : undefined,
          accountProfileId: terminal.accountProfileId,
          autoConfirm: terminal.autoConfirm,
        });
        if (
          !this.state.updateRestoredTerminalLaunch(terminal.id, launch.command, {
            profileId: terminal.profileId === CLI_NATIVE_PROFILE_ID ? CLI_NATIVE_PROFILE_ID : profile?.id,
            model: terminal.model || (profile ? profileModel(profile, 'codex') : undefined) || this.i18n.t('terminal.defaultCodexModel'),
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
    const restored = this.state.workspaces().flatMap((workspace) =>
      workspace.terminals
        .filter((terminal) => terminal.agentType === 'opencode')
        // A terminal still running was adopted rather than restarted, and its launch is the
        // one already in flight. Regenerating it would ask the CLI to hand over a session its
        // own live process is holding, which is what raised the reclaim prompt on every reload.
        .filter((terminal) => !this.state.isAdoptedTerminal(terminal.id))
        .map((terminal) => ({ workspaceId: workspace.id, terminal })),
    );
    if (restored.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      restored.map(async ({ workspaceId, terminal }) => {
        const model = terminal.model === OPENCODE_DEFAULT_MODEL ? undefined : terminal.model;
        const task = this.todos
          .tasksFor(workspaceId)
          .find((candidate) => candidate.terminalId === terminal.id);
        const sessionId = task
          ? compatibleTodoSessionId(task, this.agents.sessions(), this.agents.events())
          : compatibleNativeSessionId(
              'opencode',
              terminal.nativeSessionId,
              undefined,
              this.agents.sessions(),
              this.agents.events(),
            );
        const launch = await this.agents.prepareOpenCodeLaunch({
          terminalId: terminal.id,
          workspaceId,
          sessionId,
          model,
          continueLast: !sessionId,
          autoConfirm: terminal.autoConfirm,
        });
        if (
          !this.state.updateRestoredTerminalLaunch(terminal.id, launch.command, {
            model: terminal.model,
            nativeSessionId: sessionId,
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
      this.showToast(this.i18n.t('restore.openCodeFailed', { count: failed }), 'attention');
    }
  }

  private async refreshRestoredNativeModelLaunches(
    agentType: 'grok' | 'pi' | 'antigravity',
  ): Promise<void> {
    const agentName = AGENT_LABELS[agentType];
    const restored = this.state.workspaces().flatMap((workspace) =>
      workspace.terminals
        .filter((terminal) => terminal.agentType === agentType)
        .filter((terminal) => !this.state.isAdoptedTerminal(terminal.id))
        .map((terminal) => ({ workspaceId: workspace.id, terminal })),
    );
    if (restored.length === 0) {
      return;
    }
    const results = await Promise.allSettled(
      restored.map(async ({ workspaceId, terminal }) => {
        const task = this.todos
          .tasksFor(workspaceId)
          .find((item) => item.terminalId === terminal.id);
        const latestEventSessionId =
          agentType === 'antigravity'
            ? this.agents
                .events()
                .find(
                  (event) =>
                    event.terminalId === terminal.id &&
                    event.agentType === 'antigravity' &&
                    event.nativeSessionId?.trim(),
                )?.nativeSessionId
            : undefined;
        const sessionId = task
          ? compatibleTodoSessionId(task, this.agents.sessions(), this.agents.events())
          : compatibleNativeSessionId(
              agentType,
              latestEventSessionId ?? terminal.nativeSessionId,
              undefined,
              this.agents.sessions(),
              this.agents.events(),
            );
        const explicitModel =
          !terminal.model ||
          terminal.model === agentName ||
          (agentType === 'antigravity' && terminal.model === ANTIGRAVITY_DEFAULT_MODEL)
            ? undefined
            : terminal.model;
        const request = {
          terminalId: terminal.id,
          workspaceId,
          sessionId,
          continueLast: !sessionId,
          model: explicitModel,
        };
        const launch =
          agentType === 'pi'
            ? await this.agents.preparePiLaunch(request)
            : agentType === 'antigravity'
              ? await this.agents.prepareAntigravityLaunch({
                  ...request,
                  workingDirectory: terminal.workingDirectory,
                  autoConfirm: terminal.autoConfirm,
                })
              : await this.agents.prepareGrokLaunch({
                  ...request,
                  autoConfirm: terminal.autoConfirm,
                });
        if (
          !this.state.updateRestoredTerminalLaunch(terminal.id, launch.command, {
            model: terminal.model,
            nativeSessionId: sessionId,
          })
        ) {
          throw new Error(
            this.i18n.t('restore.terminalMissing', { agent: agentName, name: terminal.name }),
          );
        }
      }),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      this.showToast(
        this.i18n.t('restore.agentFailed', { agent: agentName, count: failed }),
        'attention',
      );
    }
  }

  private mountWorkspace(workspaceId: string | undefined): void {
    if (!workspaceId || this.mountedWorkspaceIds().includes(workspaceId)) {
      return;
    }
    this.mountedWorkspaceIds.update((workspaceIds) => [...workspaceIds, workspaceId]);
  }
}
