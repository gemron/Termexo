import { computed, inject, Injectable, signal } from '@angular/core';

import { AgentEvent, EVENT_STATUS } from '../models/agent.models';
import { createDefaultWorkspaces } from '../models/workspace.fixtures';
import {
  AGENT_LABELS,
  AgentType,
  CreateTerminalInput,
  LayoutMode,
  MODEL_PROFILES,
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

  async initialize(): Promise<void> {
    const storedWorkspaces = await this.repository.list();
    const initialWorkspaces =
      storedWorkspaces.length > 0
        ? this.restartRestoredTerminals(storedWorkspaces)
        : createDefaultWorkspaces();

    this.workspaceItems.set(this.sortWorkspaces(initialWorkspaces));
    const firstWorkspace = initialWorkspaces[0];
    this.activeWorkspaceId.set(firstWorkspace?.id ?? null);
    this.activeTerminalId.set(firstWorkspace?.terminals[0]?.id ?? null);

    await this.repository.saveAll(initialWorkspaces);
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
      projectPath: normalizedPath,
      projectType: 'Local project',
      activeBranch: 'main',
      favorite: false,
      lastOpenedAt: Date.now(),
      layout: 'single',
      terminals: [],
    };

    this.workspaceItems.update((items) => this.sortWorkspaces([...items, workspace]));
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

  switchAllModels(profileId: string): number {
    const profile = MODEL_PROFILES.find((item) => item.id === profileId);
    const workspace = this.activeWorkspace();
    if (!profile || !workspace) {
      return 0;
    }

    const terminals = workspace.terminals.map((terminal) =>
      terminal.agentType === 'shell'
        ? terminal
        : { ...terminal, model: profile.name, status: 'STARTING' as const },
    );
    this.replaceWorkspace({ ...workspace, terminals });
    void this.repository.save({ ...workspace, terminals });
    return terminals.filter((terminal) => terminal.agentType !== 'shell').length;
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
      this.sortWorkspaces(items.map((item) => (item.id === workspace.id ? workspace : item))),
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
          : agentType === 'gemini'
            ? 'Gemini Pro'
            : agentType === 'codex'
              ? 'GPT Codex'
              : 'Local'),
      branch: workspace.activeBranch,
      command: input.command ?? this.defaultCommand(agentType),
      nativeSessionId: input.nativeSessionId,
    };
  }

  private defaultCommand(agentType: AgentType): string {
    return agentType === 'shell' ? '' : agentType;
  }

  private sortWorkspaces(workspaces: Workspace[]): Workspace[] {
    return [...workspaces].sort(
      (left, right) =>
        Number(right.favorite) - Number(left.favorite) || right.lastOpenedAt - left.lastOpenedAt,
    );
  }

  private restartRestoredTerminals(workspaces: Workspace[]): Workspace[] {
    return workspaces.map((workspace) => ({
      ...workspace,
      terminals: workspace.terminals.map((terminal) => ({
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
