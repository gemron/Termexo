import { Component, computed, effect, HostListener, inject, signal } from '@angular/core';

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
} from './core/models/workspace.models';
import { AgentService } from './core/services/agent.service';
import { AppStateService } from './core/services/app-state.service';
import { DirectoryPickerService } from './core/services/directory-picker.service';
import { TerminalGatewayService } from './core/services/terminal-gateway.service';
import { AgentSettingsDialogComponent } from './dialogs/agent-settings-dialog';
import {
  ClaudeLaunchDialogComponent,
  ClaudeLaunchDialogValue,
} from './dialogs/claude-launch-dialog';
import { CodexLaunchDialogComponent, CodexLaunchDialogValue } from './dialogs/codex-launch-dialog';
import { CreateWorkspaceDialogComponent } from './dialogs/create-workspace-dialog';
import {
  EditWorkspaceDialogComponent,
  WorkspaceAppearanceValue,
} from './dialogs/edit-workspace-dialog';
import { ModelSwitchDialogComponent } from './dialogs/model-switch-dialog';
import { ResumeSessionValue, SessionCenterDialogComponent } from './dialogs/session-center-dialog';
import { InspectorPanelComponent } from './inspector/inspector-panel';
import { IconComponent } from './shared/icon/icon';
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
    EditWorkspaceDialogComponent,
    IconComponent,
    InspectorPanelComponent,
    ModelSwitchDialogComponent,
    SessionCenterDialogComponent,
    TerminalWorkbenchComponent,
    WorkspaceSidebarComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    'data-theme': 'termexo',
    '[style.--color-primary]': 'workspaceThemeColor()',
    '[style.--color-accent]': 'workspaceThemeColor()',
  },
})
export class App {
  protected readonly state = inject(AppStateService);
  protected readonly agents = inject(AgentService);
  private readonly directoryPicker = inject(DirectoryPickerService);
  private readonly terminalGateway = inject(TerminalGatewayService);
  private readonly handledEventKeys = new Set<string>();
  private readonly eventStatusCutoff = Date.now();
  private readonly preferredTerminalIds = signal<Record<string, string[]>>({});
  private resizeStartX = 0;
  private resizeStartWidth = 0;

  protected readonly createWorkspaceOpen = signal(false);
  protected readonly editingWorkspaceId = signal<string | null>(null);
  protected readonly claudeLaunchOpen = signal(false);
  protected readonly codexLaunchOpen = signal(false);
  protected readonly sessionCenterOpen = signal(false);
  protected readonly settingsOpen = signal(false);
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
  protected readonly launchingClaude = signal(false);
  protected readonly launchingCodex = signal(false);
  protected readonly selectedTerminalDirectory = signal<string | null>(null);
  protected readonly toastMessage = signal<string | null>(null);
  protected readonly networkTestResult = signal<NetworkTestResult | null>(null);
  protected readonly cliOperationPlan = signal<CliOperationPlan | null>(null);
  protected readonly cliOperationResult = signal<CliOperationResult | null>(null);
  protected readonly activeTerminalId = computed(() => this.state.activeTerminal()?.id ?? null);
  protected readonly editingWorkspace = computed(
    () =>
      this.state.workspaces().find((workspace) => workspace.id === this.editingWorkspaceId()) ??
      null,
  );
  protected readonly workspaceThemeColor = computed(() =>
    normalizeWorkspaceThemeColor(this.state.activeWorkspace()?.themeColor),
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
  }

  protected async createTerminal(agentType: AgentType): Promise<void> {
    this.agentMenuOpen.set(false);
    const workingDirectory = await this.selectTerminalDirectory();
    if (!workingDirectory) {
      return;
    }

    const terminal = this.state.createTerminal({ agentType, workingDirectory });
    if (terminal) {
      this.showToast(`${terminal.name} 已创建`);
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
      this.showToast(installation?.diagnostic ?? '未检测到 Codex CLI');
      return;
    }

    const terminalId = crypto.randomUUID();
    this.launchingCodex.set(true);
    try {
      const launch = await this.agents.prepareCodexLaunch({
        terminalId,
        workspaceId: workspace.id,
        model: value.model,
        accountProfileId: value.accountProfileId,
      });
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: 'codex',
        name: value.name || undefined,
        command: launch.command,
        model: value.model ?? 'Codex 默认模型',
        workingDirectory,
        accountProfileId: value.accountProfileId,
      });
      this.codexLaunchOpen.set(false);
      this.selectedTerminalDirectory.set(null);
      if (terminal) {
        this.showToast(`${terminal.name} 已启动`);
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
      const profile = this.agents.modelProfiles().find((item) => item.id === value.profileId);
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
        this.showToast(`${terminal.name} 已启动`);
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

    const terminalId = crypto.randomUUID();
    (isCodex ? this.launchingCodex : this.launchingClaude).set(true);
    try {
      const launch = isCodex
        ? await this.agents.prepareCodexLaunch({
            terminalId,
            workspaceId: workspace.id,
            sessionId: value.session.nativeSessionId,
            model: value.model,
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
      const profile = isCodex
        ? undefined
        : this.agents.modelProfiles().find((item) => item.id === value.profileId);
      const terminal = this.state.createTerminal({
        id: terminalId,
        agentType: value.session.agentType,
        name: value.session.title,
        command: launch.command,
        model:
          profile?.name ??
          value.model ??
          value.session.modelName ??
          (isCodex ? 'Codex 默认模型' : 'Claude Sonnet'),
        nativeSessionId: value.session.nativeSessionId,
        workingDirectory: value.session.projectPath ?? workspace.projectPath,
        profileId: isCodex ? undefined : value.profileId,
        mcpProfileId: isCodex ? undefined : value.mcpProfileId,
        accountProfileId: value.accountProfileId,
      });
      this.sessionCenterOpen.set(false);
      if (terminal) {
        this.showToast(`正在恢复 ${value.session.title}`);
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
  }

  protected toggleWorkspaceMaximize(): void {
    this.workspaceMaximized.update((maximized) => !maximized);
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
    this.createWorkspaceOpen.set(false);
    this.showToast(`工作区 ${value.name} 已创建`);
  }

  protected openWorkspaceEditor(workspaceId: string): void {
    this.editingWorkspaceId.set(workspaceId);
  }

  protected saveWorkspaceAppearance(value: WorkspaceAppearanceValue): void {
    if (this.state.updateWorkspaceAppearance(value.workspaceId, value.name, value.themeColor)) {
      this.editingWorkspaceId.set(null);
      this.showToast(`工作区 ${value.name} 已更新`);
    }
  }

  protected async switchModels(profileId: string): Promise<void> {
    if (this.launchingClaude()) {
      return;
    }

    const workspace = this.state.activeWorkspace();
    const profile = this.agents.modelProfiles().find((item) => item.id === profileId);
    const terminals =
      workspace?.terminals.filter((terminal) => terminal.agentType === 'claude') ?? [];
    if (!profile || terminals.length === 0) {
      this.modelSwitchOpen.set(false);
      this.showToast(profile ? '当前 Workspace 没有 Claude Code 终端' : '模型 Profile 不存在');
      return;
    }
    if (profile.baseUrl && !profile.hasCredential) {
      this.modelSwitchOpen.set(false);
      this.showToast(`请先在设置中为 ${profile.name} 配置 API Key`);
      return;
    }

    this.launchingClaude.set(true);
    try {
      const results = await Promise.allSettled(
        terminals.map(async (terminal) => {
          const launch = await this.agents.prepareLaunch({
            terminalId: terminal.id,
            workspaceId: workspace?.id,
            profileId,
            mcpProfileId: terminal.mcpProfileId,
            accountProfileId: terminal.accountProfileId,
          });
          await this.terminalGateway.close(terminal.id).catch(() => undefined);
          if (
            !this.state.restartTerminalWithProfile(
              terminal.id,
              launch.command,
              profile.name,
              profileId,
              terminal.mcpProfileId,
            )
          ) {
            throw new Error(`Claude 终端 ${terminal.name} 已不存在`);
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
          ? `${switched} 个已切换，${failures.length} 个失败：${this.errorMessage(failures[0].reason)}`
          : `${switched} 个 Claude Code 终端已切换到 ${profile.name}，已使用新会话避免重复加载上下文`,
      );
    } finally {
      this.launchingClaude.set(false);
    }
  }

  protected async saveModelProfile(input: ModelProfileInput): Promise<void> {
    try {
      await this.agents.saveModelProfile(input);
      this.showToast('模型 Profile 已保存');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async saveAccountProfile(input: AccountProfileInput): Promise<void> {
    try {
      await this.agents.saveAccountProfile(input);
      this.showToast('登录账号已保存');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteAccountProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteAccountProfile(profileId);
      this.showToast('账号 Profile 已移除，磁盘凭据目录已保留');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async refreshAccountProfile(profileId: string): Promise<void> {
    try {
      await this.agents.refreshAccountProfile(profileId);
      const profile = this.agents.accountProfiles().find((item) => item.id === profileId);
      this.showToast(profile?.diagnostic ?? '账号状态已刷新');
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
        name: `${profile.name} 登录`,
        command: launch.command,
        model: '账号登录',
        workingDirectory,
      });
      this.settingsOpen.set(false);
      if (terminal) {
        this.showToast(`已打开 ${profile.name} 官方登录流程`);
      }
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteModelProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteModelProfile(profileId);
      this.showToast('模型 Profile 已删除');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async saveMcpProfile(input: McpProfileInput): Promise<void> {
    try {
      await this.agents.saveMcpProfile(input);
      this.showToast('MCP Profile 已保存');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteMcpProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteMcpProfile(profileId);
      this.showToast('MCP Profile 已删除');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async saveNetworkProfile(input: NetworkProfileInput): Promise<void> {
    try {
      await this.agents.saveNetworkProfile(input);
      this.networkTestResult.set(null);
      this.showToast('网络代理 Profile 已保存');
    } catch (error) {
      this.showToast(this.errorMessage(error));
    }
  }

  protected async deleteNetworkProfile(profileId: string): Promise<void> {
    try {
      await this.agents.deleteNetworkProfile(profileId);
      this.networkTestResult.set(null);
      this.showToast('网络代理 Profile 已删除');
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
    this.showToast('Claude Code 与 Codex CLI 检测已完成');
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

  private showToast(message: string): void {
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
      this.showToast(`选择目录失败：${this.errorMessage(error)}`);
      return null;
    }
  }

  private async initialize(): Promise<void> {
    await this.state.initialize();
    await this.agents.initialize();
  }
}
