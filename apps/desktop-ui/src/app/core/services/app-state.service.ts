import { computed, inject, Injectable, signal } from '@angular/core';

import { AgentEvent, EVENT_STATUS } from '../models/agent.models';
import { createDefaultWorkspaces } from '../models/workspace.fixtures';
import {
  AGENT_LABELS,
  AgentType,
  CreateTerminalInput,
  DEFAULT_TERMINAL_GRID_DIMENSION,
  DEFAULT_WORKSPACE_THEME_COLOR,
  LayoutMode,
  normalizeTerminalGridDimension,
  normalizeWorkspaceThemeColor,
  TerminalSession,
  TerminalStatus,
  Workspace,
} from '../models/workspace.models';
import { WorkspaceRepository } from './workspace.repository';

const DEFAULT_SHELL = 'powershell.exe';

@Injectable({ providedIn: 'root' })
export class AppStateService {
  private readonly repository = inject(WorkspaceRepository);
  private readonly workspaceItems = signal<Workspace[]>([]);
  private readonly activeWorkspaceId = signal<string | null>(null);
  private readonly activeTerminalId = signal<string | null>(null);

  readonly workspaces = this.workspaceItems.asReadonly();
  readonly activeWorkspace = computed(
    () => this.workspaceItems().find((item) => item.id === this.activeWorkspaceId()) ?? null,
  );
  readonly activeTerminal = computed(() => {
    const workspace = this.activeWorkspace();
    return (
      workspace?.terminals.find((terminal) => terminal.id === this.activeTerminalId()) ??
      workspace?.terminals[0] ??
      null
    );
  });
  readonly runningAgentCount = computed(
    () =>
      this.activeWorkspace()?.terminals.filter(
        (terminal) =>
          terminal.agentType !== 'shell' &&
          !['STOPPED', 'FAILED', 'DISCONNECTED'].includes(terminal.status),
      ).length ?? 0,
  );
  readonly claudeTerminalCount = computed(
    () =>
      this.activeWorkspace()?.terminals.filter((terminal) => terminal.agentType === 'claude')
        .length ?? 0,
  );
  readonly codexTerminalCount = computed(
    () =>
      this.activeWorkspace()?.terminals.filter((terminal) => terminal.agentType === 'codex')
        .length ?? 0,
  );
  readonly openCodeTerminalCount = computed(
    () =>
      this.activeWorkspace()?.terminals.filter((terminal) => terminal.agentType === 'opencode')
        .length ?? 0,
  );

  agentCountFor(agentType: 'claude' | 'codex' | 'opencode'): number {
    return (
      this.activeWorkspace()?.terminals.filter((terminal) => terminal.agentType === agentType)
        .length ?? 0
    );
  }

  async initialize(): Promise<void> {
    const storedWorkspaces = await this.repository.list();
    const initialWorkspaces =
      storedWorkspaces.length > 0
        ? this.restartRestoredTerminals(storedWorkspaces)
        : createDefaultWorkspaces();

    const orderedWorkspaces = this.normalizeWorkspaceOrder(initialWorkspaces);
    this.workspaceItems.set(orderedWorkspaces);
    const firstWorkspace = orderedWorkspaces[0];
    this.activeWorkspaceId.set(firstWorkspace?.id ?? null);
    this.activeTerminalId.set(firstWorkspace?.terminals[0]?.id ?? null);

    await this.repository.saveAll(orderedWorkspaces);
  }

  selectWorkspace(workspaceId: string): void {
    const workspace = this.workspaceItems().find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const updatedWorkspace = { ...workspace, lastOpenedAt: Date.now() };
    this.replaceWorkspace(updatedWorkspace);
    this.activeWorkspaceId.set(workspaceId);
    this.activeTerminalId.set(updatedWorkspace.terminals[0]?.id ?? null);
    void this.repository.save(updatedWorkspace);
  }

  selectTerminal(terminalId: string): void {
    this.activeTerminalId.set(terminalId);
  }

  createWorkspace(name: string, projectPath: string): void {
    const normalizedName = name.trim();
    const normalizedPath = projectPath.trim();
    if (!normalizedName || !normalizedPath) {
      return;
    }

    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: normalizedName,
      themeColor: DEFAULT_WORKSPACE_THEME_COLOR,
      sortOrder: this.workspaceItems().length,
      projectPath: normalizedPath,
      projectType: 'Local project',
      activeBranch: 'main',
      favorite: false,
      lastOpenedAt: Date.now(),
      layout: 'single',
      gridColumns: DEFAULT_TERMINAL_GRID_DIMENSION,
      gridRows: DEFAULT_TERMINAL_GRID_DIMENSION,
      terminals: [],
    };

    this.workspaceItems.update((items) => [...items, workspace]);
    this.activeWorkspaceId.set(workspace.id);
    this.activeTerminalId.set(null);
    void this.repository.save(workspace);
  }

  async deleteWorkspace(workspaceId: string): Promise<Workspace | null> {
    const workspaces = this.workspaceItems();
    const removedIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (removedIndex < 0) {
      return null;
    }

    const removedWorkspace = workspaces[removedIndex];
    const remainingWorkspaces = this.normalizeWorkspaceOrder(
      workspaces.filter((workspace) => workspace.id !== workspaceId),
    );
    await this.repository.delete(workspaceId);
    await this.repository.saveAll(remainingWorkspaces);
    this.workspaceItems.set(remainingWorkspaces);

    if (this.activeWorkspaceId() === workspaceId) {
      const nextWorkspace =
        remainingWorkspaces[Math.min(removedIndex, remainingWorkspaces.length - 1)];
      this.activeWorkspaceId.set(nextWorkspace?.id ?? null);
      this.activeTerminalId.set(nextWorkspace?.terminals[0]?.id ?? null);
    }

    return removedWorkspace;
  }

  async mergeWorkspaces(
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
  ): Promise<Workspace | null> {
    if (sourceWorkspaceId === targetWorkspaceId) {
      return null;
    }

    const workspaces = this.workspaceItems();
    const sourceWorkspace = workspaces.find((workspace) => workspace.id === sourceWorkspaceId);
    const targetWorkspace = workspaces.find((workspace) => workspace.id === targetWorkspaceId);
    if (!sourceWorkspace || !targetWorkspace) {
      return null;
    }

    const targetTerminalIds = new Set(targetWorkspace.terminals.map((terminal) => terminal.id));
    const movedTerminals = sourceWorkspace.terminals.filter(
      (terminal) => !targetTerminalIds.has(terminal.id),
    );
    const mergedWorkspace: Workspace = {
      ...targetWorkspace,
      lastOpenedAt: Date.now(),
      terminals: [...targetWorkspace.terminals, ...movedTerminals],
    };
    const mergedWorkspaces = this.normalizeWorkspaceOrder(
      workspaces
        .filter((workspace) => workspace.id !== sourceWorkspaceId)
        .map((workspace) => (workspace.id === targetWorkspaceId ? mergedWorkspace : workspace)),
    );
    const normalizedMergedWorkspace = mergedWorkspaces.find(
      (workspace) => workspace.id === targetWorkspaceId,
    )!;

    await this.repository.saveAll(mergedWorkspaces);
    try {
      await this.repository.delete(sourceWorkspaceId);
    } catch (error) {
      await this.repository.saveAll(workspaces).catch(() => undefined);
      throw error;
    }

    const previouslyActiveWorkspaceId = this.activeWorkspaceId();
    const previouslyActiveTerminalId = this.activeTerminalId();
    this.workspaceItems.set(mergedWorkspaces);
    this.activeWorkspaceId.set(targetWorkspaceId);
    const preservesActiveTerminal =
      (previouslyActiveWorkspaceId === sourceWorkspaceId ||
        previouslyActiveWorkspaceId === targetWorkspaceId) &&
      normalizedMergedWorkspace.terminals.some(
        (terminal) => terminal.id === previouslyActiveTerminalId,
      );
    this.activeTerminalId.set(
      preservesActiveTerminal
        ? previouslyActiveTerminalId
        : (normalizedMergedWorkspace.terminals[0]?.id ?? null),
    );

    return normalizedMergedWorkspace;
  }

  toggleFavorite(workspaceId: string): void {
    const workspace = this.workspaceItems().find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const updatedWorkspace = { ...workspace, favorite: !workspace.favorite };
    this.replaceWorkspace(updatedWorkspace);
    void this.repository.save(updatedWorkspace);
  }

  moveWorkspace(workspaceId: string, direction: -1 | 1): boolean {
    const workspaces = [...this.workspaceItems()];
    const currentIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= workspaces.length) {
      return false;
    }

    [workspaces[currentIndex], workspaces[targetIndex]] = [
      workspaces[targetIndex],
      workspaces[currentIndex],
    ];
    const orderedWorkspaces = this.normalizeWorkspaceOrder(workspaces);
    this.workspaceItems.set(orderedWorkspaces);
    void this.repository.saveAll(orderedWorkspaces);
    return true;
  }

  updateWorkspaceAppearance(workspaceId: string, name: string, themeColor: string): boolean {
    const workspace = this.workspaceItems().find((item) => item.id === workspaceId);
    const normalizedName = name.trim();
    if (!workspace || !normalizedName) {
      return false;
    }

    const updatedWorkspace = {
      ...workspace,
      name: normalizedName,
      themeColor: normalizeWorkspaceThemeColor(themeColor),
    };
    this.replaceWorkspace(updatedWorkspace);
    void this.repository.save(updatedWorkspace);
    return true;
  }

  createTerminal(input: CreateTerminalInput): TerminalSession | null {
    const workspace = this.activeWorkspace();
    if (!workspace) {
      return null;
    }

    const terminal = this.buildTerminal(workspace, input);
    const updatedWorkspace = {
      ...workspace,
      terminals: [...workspace.terminals, terminal],
    };
    this.replaceWorkspace(updatedWorkspace);
    this.activeTerminalId.set(terminal.id);
    void this.repository.save(updatedWorkspace);
    return terminal;
  }

  closeTerminal(terminalId: string): void {
    const workspace = this.activeWorkspace();
    if (!workspace) {
      return;
    }

    const updatedTerminals = workspace.terminals.filter((terminal) => terminal.id !== terminalId);
    const updatedWorkspace = { ...workspace, terminals: updatedTerminals };
    this.replaceWorkspace(updatedWorkspace);

    if (this.activeTerminalId() === terminalId) {
      this.activeTerminalId.set(updatedTerminals[0]?.id ?? null);
    }
    void this.repository.save(updatedWorkspace);
  }

  moveTerminal(terminalId: string, direction: -1 | 1): boolean {
    const workspace = this.activeWorkspace();
    if (!workspace) {
      return false;
    }
    const terminals = [...workspace.terminals];
    const currentIndex = terminals.findIndex((terminal) => terminal.id === terminalId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= terminals.length) {
      return false;
    }

    [terminals[currentIndex], terminals[targetIndex]] = [
      terminals[targetIndex],
      terminals[currentIndex],
    ];
    const updatedWorkspace = { ...workspace, terminals };
    this.replaceWorkspace(updatedWorkspace);
    void this.repository.save(updatedWorkspace);
    return true;
  }

  setLayout(layout: LayoutMode): void {
    this.updateActiveWorkspace((workspace) => ({ ...workspace, layout }));
  }

  setGridDimensions(columns: number, rows: number): void {
    this.updateActiveWorkspace((workspace) => ({
      ...workspace,
      layout: 'grid',
      gridColumns: normalizeTerminalGridDimension(columns),
      gridRows: normalizeTerminalGridDimension(rows),
    }));
  }

  updateTerminalStatus(terminalId: string, status: TerminalStatus): void {
    this.updateTerminal(terminalId, (terminal) => ({ ...terminal, status }));
  }

  /** Renames a terminal, ignoring a blank name so a tab can never lose its label. */
  renameTerminal(terminalId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    this.updateTerminal(terminalId, (terminal) => ({ ...terminal, name: trimmed }));
  }

  updateRestoredTerminalLaunch(
    terminalId: string,
    command: string,
    metadata: Partial<
      Pick<TerminalSession, 'model' | 'profileId' | 'mcpProfileId' | 'accountProfileId'>
    > = {},
  ): boolean {
    const workspace = this.workspaceItems().find((item) =>
      item.terminals.some((terminal) => terminal.id === terminalId),
    );
    if (!workspace) {
      return false;
    }

    const updatedWorkspace = {
      ...workspace,
      terminals: workspace.terminals.map((terminal) =>
        terminal.id === terminalId
          ? { ...terminal, ...metadata, command, status: 'STARTING' as const }
          : terminal,
      ),
    };
    this.replaceWorkspace(updatedWorkspace);
    void this.repository.save(updatedWorkspace);
    return true;
  }

  /**
   * Profiles the given native session last ran with, across every workspace.
   *
   * Native transcripts carry no Termexo profile, so resuming a session would
   * otherwise fall back to the default (native) model. Terminals persist the
   * profiles they launched with, which makes them the record of that choice.
   */
  findSessionLaunchProfiles(
    nativeSessionId: string,
  ): Pick<TerminalSession, 'profileId' | 'mcpProfileId' | 'accountProfileId'> | null {
    const terminal = this.workspaceItems()
      .slice()
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .flatMap((workspace) => workspace.terminals)
      .find((item) => item.nativeSessionId === nativeSessionId && item.profileId);
    if (!terminal) {
      return null;
    }
    return {
      profileId: terminal.profileId,
      mcpProfileId: terminal.mcpProfileId,
      accountProfileId: terminal.accountProfileId,
    };
  }

  applyAgentEvent(event: AgentEvent): void {
    const status = EVENT_STATUS[event.eventType];
    const workspace = this.workspaceItems().find((item) =>
      item.terminals.some((terminal) => terminal.id === event.terminalId),
    );
    if (!workspace || !status) {
      return;
    }

    const updatedWorkspace = {
      ...workspace,
      terminals: workspace.terminals.map((terminal) =>
        terminal.id === event.terminalId
          ? {
              ...terminal,
              status,
              nativeSessionId: event.nativeSessionId ?? terminal.nativeSessionId,
            }
          : terminal,
      ),
    };
    this.replaceWorkspace(updatedWorkspace);
    void this.repository.save(updatedWorkspace);
  }

  restartTerminalWithProfile(
    terminalId: string,
    command: string,
    model: string,
    profileId?: string,
    mcpProfileId?: string,
  ): boolean {
    const workspace = this.activeWorkspace();
    const terminal = workspace?.terminals.find((item) => item.id === terminalId);
    if (!workspace || !terminal || terminal.agentType === 'shell') {
      return false;
    }

    const terminals = workspace.terminals.map((terminal) =>
      terminal.id !== terminalId
        ? terminal
        : {
            ...terminal,
            command,
            model,
            profileId,
            mcpProfileId:
              terminal.agentType === 'claude' ? (mcpProfileId ?? terminal.mcpProfileId) : undefined,
            nativeSessionId: undefined,
            status: 'STARTING' as const,
            runtimeRevision: (terminal.runtimeRevision ?? 0) + 1,
          },
    );
    this.replaceWorkspace({ ...workspace, terminals });
    void this.repository.save({ ...workspace, terminals });
    return true;
  }

  private updateTerminal(
    terminalId: string,
    update: (terminal: TerminalSession) => TerminalSession,
  ): void {
    const workspace = this.workspaceItems().find((item) =>
      item.terminals.some((terminal) => terminal.id === terminalId),
    );
    if (!workspace) {
      return;
    }
    const updatedWorkspace = {
      ...workspace,
      terminals: workspace.terminals.map((terminal) =>
        terminal.id === terminalId ? update(terminal) : terminal,
      ),
    };
    this.replaceWorkspace(updatedWorkspace);
    void this.repository.save(updatedWorkspace);
  }

  private updateActiveWorkspace(update: (workspace: Workspace) => Workspace): void {
    const workspace = this.activeWorkspace();
    if (!workspace) {
      return;
    }

    const updatedWorkspace = update(workspace);
    this.replaceWorkspace(updatedWorkspace);
    void this.repository.save(updatedWorkspace);
  }

  private replaceWorkspace(workspace: Workspace): void {
    this.workspaceItems.update((items) =>
      items.map((item) => (item.id === workspace.id ? workspace : item)),
    );
  }

  private buildTerminal(workspace: Workspace, input: CreateTerminalInput): TerminalSession {
    const agentType: AgentType = input.agentType;
    const agentLabel = AGENT_LABELS[agentType];

    return {
      id: input.id ?? crypto.randomUUID(),
      name: input.name?.trim() || `${agentLabel} ${workspace.terminals.length + 1}`,
      workingDirectory: input.workingDirectory ?? workspace.projectPath,
      shell: DEFAULT_SHELL,
      agentType,
      status: 'STARTING',
      model:
        input.model ??
        (agentType === 'claude'
          ? 'Claude Sonnet'
          : agentType === 'codex'
            ? 'GPT Codex'
            : agentType === 'opencode'
              ? 'OpenCode 默认模型'
              : 'Local'),
      branch: workspace.activeBranch,
      command: input.command ?? this.defaultCommand(agentType),
      nativeSessionId: input.nativeSessionId,
      profileId: input.profileId,
      mcpProfileId: input.mcpProfileId,
      accountProfileId: input.accountProfileId,
      runtimeRevision: 0,
    };
  }

  private defaultCommand(agentType: AgentType): string {
    return agentType === 'shell' ? '' : agentType;
  }

  private normalizeWorkspaceOrder(workspaces: Workspace[]): Workspace[] {
    return workspaces.map((workspace, sortOrder) => ({
      ...workspace,
      sortOrder,
    }));
  }

  private restartRestoredTerminals(workspaces: Workspace[]): Workspace[] {
    return workspaces.map((workspace) => ({
      ...workspace,
      terminals: workspace.terminals
        .filter((terminal) => (terminal.agentType as string) !== 'gemini')
        .map((terminal) => ({
          ...terminal,
          status: 'STARTING',
          command: terminal.command ?? this.restoredCommand(terminal),
        })),
    }));
  }

  private restoredCommand(terminal: TerminalSession): string {
    if (terminal.agentType === 'claude' && terminal.nativeSessionId) {
      const sessionId = terminal.nativeSessionId.replaceAll("'", "''");
      return `claude --resume '${sessionId}'`;
    }
    return this.defaultCommand(terminal.agentType);
  }
}
