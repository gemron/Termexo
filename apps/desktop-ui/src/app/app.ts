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
  CliOperationPlan,
  CliOperationRequest,
  CliOperationResult,
  McpProfileInput,
  ModelProfileInput,
  NetworkProfileInput,
  NetworkTestResult,
} from './core/models/agent.models';
import {
  AgentType,
  DEFAULT_TERMINAL_FONT_SIZE,
  LayoutMode,
  MAX_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_GRID_DIMENSION,
  MIN_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_GRID_DIMENSION,
  normalizeTerminalFontSize,
  normalizeTerminalGridDimension,
  normalizeWorkspaceThemeColor,
  TerminalStatus,
  Workspace,
} from './core/models/workspace.models';
import { I18nService } from './core/i18n/i18n.service';
import { TranslatePipe } from './core/i18n/translate.pipe';
import {
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
import { TerminalGatewayService } from './core/services/terminal-gateway.service';
import { AgentSettingsDialogComponent, SettingsTab } from './dialogs/agent-settings-dialog';
import {
  ClaudeLaunchDialogComponent,
  ClaudeLaunchDialogValue,
} from './dialogs/claude-launch-dialog';
import { CodexLaunchDialogComponent, CodexLaunchDialogValue } from './dialogs/codex-launch-dialog';
import { CreateWorkspaceDialogComponent } from './dialogs/create-workspace-dialog';
import { DeleteWorkspaceDialogComponent } from './dialogs/delete-workspace-dialog';
import {
  EditWorkspaceDialogComponent,
  WorkspaceAppearanceValue,
} from './dialogs/edit-workspace-dialog';
import { MergeWorkspaceDialogComponent } from './dialogs/merge-workspace-dialog';
import { ModelSwitchDialogComponent, ModelSwitchValue } from './dialogs/model-switch-dialog';
import { ResumeSessionValue, SessionCenterDialogComponent } from './dialogs/session-center-dialog';
import { InspectorPanelComponent } from './inspector/inspector-panel';
import { IconComponent } from './shared/icon/icon';
import { LanguageSelectorComponent } from './shared/language-selector/language-selector';
import {
  layoutTerminalCapacity,
  resolveVisibleTerminalIds,
  revealTerminalInLayout,
} from './terminal/terminal-visibility';
import { TerminalWorkbenchComponent } from './terminal/terminal-workbench';
import { WorkspaceSidebarComponent } from './workspace/workspace-sidebar';

type SidebarResizeTarget = 'workspace' | 'inspector';

const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 208;
const WORKSPACE_SIDEBAR_MIN_WIDTH = 168;
const WORKSPACE_SIDEBAR_MAX_WIDTH = 360;
const INSPECTOR_DEFAULT_WIDTH = 252;
const INSPECTOR_MIN_WIDTH = 220;
const INSPECTOR_MAX_WIDTH = 460;
const INSPECTOR_AUTO_COLLAPSE_WIDTH = 900;
const WORKSPACE_SIDEBAR_AUTO_COLLAPSE_WIDTH = 760;

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

@Component({
  selector: 'app-root',
  imports: [
    AgentSettingsDialogComponent,
    ClaudeLaunchDialogComponent,
    CodexLaunchDialogComponent,
    CreateWorkspaceDialogComponent,
    DeleteWorkspaceDialogComponent,
    EditWorkspaceDialogComponent,
    IconComponent,
    InspectorPanelComponent,
    LanguageSelectorComponent,
    MergeWorkspaceDialogComponent,
    ModelSwitchDialogComponent,
    SessionCenterDialogComponent,
    TerminalWorkbenchComponent,
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
  private readonly directoryPicker = inject(DirectoryPickerService);
  private readonly desktopNotifications = inject(DesktopNotificationService);
  private readonly terminalGateway = inject(TerminalGatewayService);
  private readonly handledEventKeys = new Set<string>();
  private readonly eventStatusCutoff = Date.now();
  private readonly preferredTerminalIds = signal<Record<string, string[]>>({});
  private readonly mountedWorkspaceIds = signal<string[]>([]);
  private previousGlobalNoticeKeys = new Set<string>();
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private previousViewportWidth = Number.POSITIVE_INFINITY;

  protected readonly createWorkspaceOpen = signal(false);
  protected readonly editingWorkspaceId = signal<string | null>(null);
  protected readonly claudeLaunchOpen = signal(false);
  protected readonly codexLaunchOpen = signal(false);
  protected readonly sessionCenterOpen = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly settingsInitialTab = signal<SettingsTab>('diagnostics');
  protected readonly settingsInitialModelProfileId = signal('');
  protected readonly modelSwitchOpen = signal(false);
  protected readonly agentMenuOpen = signal(false);
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
  protected readonly minGridDimension = MIN_TERMINAL_GRID_DIMENSION;
  protected readonly maxGridDimension = MAX_TERMINAL_GRID_DIMENSION;
  protected readonly minTerminalFontSize = MIN_TERMINAL_FONT_SIZE;
  protected readonly maxTerminalFontSize = MAX_TERMINAL_FONT_SIZE;
  protected readonly gridColumns = computed(() =>
    normalizeTerminalGridDimension(this.state.activeWorkspace()?.gridColumns),
  );
  protected readonly gridRows = computed(() =>
    normalizeTerminalGridDimension(this.state.activeWorkspace()?.gridRows),
  );
  protected readonly gridCapacity = computed(() => this.gridColumns() * this.gridRows());
  protected readonly gridCells = computed(() => Array.from({ length: this.gridCapacity() }));
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
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'codex',
        name: value.name || undefined,
        command: launch.command,
        model: profile?.name ?? value.model ?? this.i18n.t('terminal.defaultCodexModel'),
        workingDirectory,
        profileId: value.profileId,
        accountProfileId: value.accountProfileId,
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
    if (profile?.baseUrl && !profile.hasCredential) {
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
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'claude',
        name: value.name || undefined,
        command: launch.command,
        model: profile?.name ?? 'Claude Sonnet',
        workingDirectory,
        profileId: value.profileId,
        mcpProfileId: value.mcpProfileId,
        accountProfileId: value.accountProfileId,
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
    const isCodex = value.session.agentType === 'codex';
    if (!workspace || (isCodex && this.launchingCodex()) || (!isCodex && this.launchingClaude())) {
      return;
    }

    const profile = this.agents.modelProfiles().find((item) => item.id === value.profileId);
    if (profile?.baseUrl && !profile.hasCredential) {
      this.openModelCredentialSettings(profile.id, profile.name);
      return;
    }

    const terminalId = crypto.randomUUID();
    (isCodex ? this.launchingCodex : this.launchingClaude).set(true);
    try {
      const launch = isCodex
        ? await this.agents.prepareCodexLaunch({
            terminalId,
            workspaceId: workspace.id,
            sessionId: value.session.nativeSessionId,
            model: value.model,
            profileId: value.profileId,
            accountProfileId: value.accountProfileId,
          })
        : await this.agents.prepareLaunch({
            terminalId,
            workspaceId: workspace.id,
            sessionId: value.session.nativeSessionId,
            profileId: value.profileId,
            mcpProfileId: value.mcpProfileId,
            accountProfileId: value.accountProfileId,
          });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: value.session.agentType,
        name: value.session.title,
        command: launch.command,
        model:
          profile?.name ??
          value.model ??
          value.session.modelName ??
          (isCodex ? this.i18n.t('terminal.defaultCodexModel') : 'Claude Sonnet'),
        nativeSessionId: value.session.nativeSessionId,
        workingDirectory: value.session.projectPath ?? workspace.projectPath,
        profileId: value.profileId,
        mcpProfileId: !isCodex ? value.mcpProfileId : undefined,
        accountProfileId: value.accountProfileId,
      });
      this.sessionCenterOpen.set(false);
      if (terminal) {
        this.showToast(this.i18n.t('terminal.resuming', { name: value.session.title }));
      }
    } catch (error) {
      this.showToast(this.errorMessage(error));
    } finally {
      (isCodex ? this.launchingCodex : this.launchingClaude).set(false);
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
    window.requestAnimationFrame(() => {
      document
        .getElementById(`terminal-tab-${terminalId}`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  protected selectTerminalFromPicker(event: Event): void {
    const terminalId = (event.target as HTMLSelectElement).value;
    if (terminalId) {
      this.selectTerminal(terminalId);
    }
  }

  protected canMoveActiveTerminal(direction: -1 | 1): boolean {
    const terminals = this.state.activeWorkspace()?.terminals ?? [];
    const currentIndex = terminals.findIndex((terminal) => terminal.id === this.activeTerminalId());
    const targetIndex = currentIndex + direction;
    return currentIndex >= 0 && targetIndex >= 0 && targetIndex < terminals.length;
  }

  protected moveActiveTerminal(direction: -1 | 1): void {
    const terminalId = this.activeTerminalId();
    if (!terminalId || !this.state.moveTerminal(terminalId, direction)) {
      return;
    }
    window.requestAnimationFrame(() => {
      document
        .getElementById(`terminal-tab-${terminalId}`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    });
  }

  protected isTerminalVisible(terminalId: string): boolean {
    return this.visibleTerminalIds().includes(terminalId);
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

  @HostListener('window:keydown', ['$event'])
  protected restoreMaximizedView(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !event.shiftKey) {
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

  protected createWorkspace(value: { name: string; projectPath: string }): void {
    this.state.createWorkspace(value.name, value.projectPath);
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
      await Promise.all(
        workspace.terminals.map((terminal) =>
          this.terminalGateway.close(terminal.id).catch(() => undefined),
        ),
      );
      const removed = await this.state.deleteWorkspace(workspace.id);
      if (!removed) {
        throw new Error(this.i18n.t('workspace.notFound'));
      }
      this.mountedWorkspaceIds.update((workspaceIds) =>
        workspaceIds.filter((workspaceId) => workspaceId !== workspace.id),
      );
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

  protected saveWorkspaceAppearance(value: WorkspaceAppearanceValue): void {
    if (this.state.updateWorkspaceAppearance(value.workspaceId, value.name, value.themeColor)) {
      this.editingWorkspaceId.set(null);
      this.showToast(this.i18n.t('workspace.updated', { name: value.name }));
    }
  }

  protected async switchModels(value: ModelSwitchValue): Promise<void> {
    const isClaude = value.apiProtocol === 'anthropic';
    if (isClaude ? this.launchingClaude() : this.launchingCodex()) {
      return;
    }

    const workspace = this.state.activeWorkspace();
    const profile = this.agents.modelProfiles().find((item) => item.id === value.profileId);
    const agentType = isClaude ? 'claude' : 'codex';
    const terminals =
      workspace?.terminals.filter((terminal) => terminal.agentType === agentType) ?? [];
    if (!profile || terminals.length === 0) {
      this.modelSwitchOpen.set(false);
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
    if (profile.baseUrl && !profile.hasCredential) {
      this.openModelCredentialSettings(profile.id, profile.name);
      return;
    }

    (isClaude ? this.launchingClaude : this.launchingCodex).set(true);
    try {
      const results = await Promise.allSettled(
        terminals.map(async (terminal) => {
          const launch = isClaude
            ? await this.agents.prepareLaunch({
                terminalId: terminal.id,
                workspaceId: workspace?.id,
                profileId: value.profileId,
                mcpProfileId: terminal.mcpProfileId,
                accountProfileId: terminal.accountProfileId,
              })
            : await this.agents.prepareCodexLaunch({
                terminalId: terminal.id,
                workspaceId: workspace?.id,
                profileId: value.profileId,
                accountProfileId: terminal.accountProfileId,
              });
          await this.terminalGateway.close(terminal.id).catch(() => undefined);
          if (
            !this.state.restartTerminalWithProfile(
              terminal.id,
              launch.command,
              profile.name,
              value.profileId,
              isClaude ? terminal.mcpProfileId : undefined,
            )
          ) {
            throw new Error(
              this.i18n.t('restore.terminalMissing', {
                agent: isClaude ? 'Claude' : 'Codex',
                name: terminal.name,
              }),
            );
          }
        }),
      );
      const switched = results.filter((result) => result.status === 'fulfilled').length;
      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      this.modelSwitchOpen.set(false);
      this.showToast(
        failures.length > 0
          ? this.i18n.t('profile.switchPartial', {
              switched,
              failed: failures.length,
              error: this.errorMessage(failures[0].reason),
            })
          : this.i18n.t(isClaude ? 'profile.switched' : 'profile.switchedCodex', {
              count: switched,
              name: profile.name,
            }),
      );
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
    await Promise.all([this.agents.detectClaude(), this.agents.detectCodex()]);
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

  private storePreference(key: string, value: boolean | number): void {
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
    this.sessionCenterOpen.set(false);
    this.modelSwitchOpen.set(false);
    this.selectedTerminalDirectory.set(null);
    this.openSettings('models', profileId);
    this.showToast(this.i18n.t('profile.credentialRequired', { name: profileName }), 'attention');
  }

  private async initialize(): Promise<void> {
    await this.state.initialize();
    await this.agents.initialize();
    await this.refreshRestoredClaudeLaunches();
    await this.refreshRestoredCodexLaunches();
    this.mountWorkspace(this.state.activeWorkspace()?.id);
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

    const results = await Promise.allSettled(
      restoredClaudeTerminals.map(async ({ workspaceId, terminal }) => {
        const profile =
          profiles.find((candidate) => candidate.id === terminal.profileId) ?? defaultProfile;
        if (!profile) {
          throw new Error(this.i18n.t('restore.noModelProfile', { name: terminal.name }));
        }
        if (profile.baseUrl && !profile.hasCredential) {
          throw new Error(this.i18n.t('restore.invalidCredential', { name: profile.name }));
        }

        const launch = await this.agents.prepareLaunch({
          terminalId: terminal.id,
          workspaceId,
          sessionId: terminal.nativeSessionId,
          profileId: profile.id,
          mcpProfileId: terminal.mcpProfileId,
          accountProfileId: terminal.accountProfileId,
        });
        if (
          !this.state.updateRestoredTerminalLaunch(terminal.id, launch.command, {
            profileId: profile.id,
            model: profile.name,
          })
        ) {
          throw new Error(
            this.i18n.t('restore.terminalMissing', { agent: 'Claude', name: terminal.name }),
          );
        }
      }),
    );
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) {
      this.showToast(this.i18n.t('restore.claudeFailed', { count: failed }), 'attention');
    }
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
        const launch = await this.agents.prepareCodexLaunch({
          terminalId: terminal.id,
          workspaceId,
          sessionId: terminal.nativeSessionId,
          profileId: profile?.id,
          model:
            terminal.model &&
            !terminal.model.includes('默认模型') &&
            !terminal.model.toLowerCase().includes('default model') &&
            !profile
              ? terminal.model
              : undefined,
          accountProfileId: terminal.accountProfileId,
        });
        if (
          !this.state.updateRestoredTerminalLaunch(terminal.id, launch.command, {
            profileId: profile?.id,
            model: profile?.name ?? terminal.model,
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

  private mountWorkspace(workspaceId: string | undefined): void {
    if (!workspaceId || this.mountedWorkspaceIds().includes(workspaceId)) {
      return;
    }
    this.mountedWorkspaceIds.update((workspaceIds) => [...workspaceIds, workspaceId]);
  }
}
