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
    profileId: string,
    mcpProfileId?: string,
  ): boolean {
    const workspace = this.activeWorkspace();
    const terminal = workspace?.terminals.find((item) => item.id === terminalId);
    if (!workspace || terminal?.agentType !== 'claude') {
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
            mcpProfileId,
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
    this.updateActiveWorkspace((workspace) => ({
      ...workspace,
      terminals: workspace.terminals.map((terminal) =>
        terminal.id === terminalId ? update(terminal) : terminal,
      ),
    }));
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
