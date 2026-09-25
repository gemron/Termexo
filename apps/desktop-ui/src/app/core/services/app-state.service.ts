import { computed, inject, Injectable, signal } from '@angular/core';

import { AgentEvent, EVENT_STATUS, TOOL_STARTED_EVENT_TYPE } from '../models/agent.models';
import { createId } from '../models/identifiers';
import {
  AGENT_LABELS,
  AgentType,
  CreateTerminalInput,
  DEFAULT_TERMINAL_GRID_DIMENSION,
  DEFAULT_WORKSPACE_THEME_COLOR,
  LayoutMode,
  normalizeTerminalGridDimension,
  normalizeWorkspaceThemeColor,
  OPENCODE_DEFAULT_MODEL,
  TerminalSession,
  TerminalStatus,
  Workspace,
} from '../models/workspace.models';
import { UnlistenFn } from './backend-bridge';
import { RemoteConnectionService } from './remote-connection.service';
import { TerminalGatewayService } from './terminal-gateway.service';
import { hasBackend, runtimeMode } from './tauri-runtime';
import { WorkspaceRepository } from './workspace.repository';

const DEFAULT_SHELL = 'powershell.exe';

/**
 * How long before this client loaded an adopted terminal's hook events still count.
 *
 * A terminal that kept running across a reload went on reporting while no window was listening,
 * and those events must still reach it. Older ones were already applied by the window that saved
 * the status this client loaded; replaying them would undo whatever the user did since, such as a
 * notice they cleared. The window covers a reload or a remote page opening with room to spare.
 */
const ADOPTED_TERMINAL_EVENT_GRACE_MS = 30_000;

/**
 * What a restart changes about a terminal. `model` and `profileId` always describe the terminal
 * after the restart; the two optional ids keep whatever the terminal already had when a switch
 * does not touch them, so switching a model cannot silently drop the account or the MCP profile.
 */
export interface TerminalRestartChanges {
  model: string;
  profileId?: string;
  mcpProfileId?: string;
  accountProfileId?: string;
}

/**
 * The sample workspaces the browser preview opens on.
 *
 * Imported on demand so the desktop build, which never seeds them, does not carry three
 * workspaces' worth of fixture data in its first load.
 */
async function loadPreviewWorkspaces(): Promise<Workspace[]> {
  const { createDefaultWorkspaces } = await import('../models/workspace.fixtures');
  return createDefaultWorkspaces();
}

@Injectable({ providedIn: 'root' })
export class AppStateService {
  private readonly repository = inject(WorkspaceRepository);
  private readonly remoteConnection = inject(RemoteConnectionService);
  private readonly gateway = inject(TerminalGatewayService);
  /**
   * Terminals that were already running when this client loaded.
   *
   * Populated once by {@link initialize} and read by the startup launch refreshes, which must not
   * regenerate a launch — or ask the user to reclaim a session — for an agent still working.
   */
  private readonly adoptedTerminals = signal<ReadonlySet<string>>(new Set());

  /** Whether the terminal was already running when this client loaded, and so was adopted. */
  isAdoptedTerminal(terminalId: string): boolean {
    return this.adoptedTerminals().has(terminalId);
  }
  private readonly workspaceItems = signal<Workspace[]>([]);
  private readonly activeWorkspaceId = signal<string | null>(null);
  private readonly activeTerminalId = signal<string | null>(null);
  private unwatchWorkspaces?: UnlistenFn;
  /** Events created before this describe a process this client never saw start. */
  private readonly loadedAt = Date.now();
  /**
   * When each terminal's status last changed, so an event describing an earlier moment cannot
   * overwrite it. Local writes are stamped with the clock, hook events with when they fired.
   */
  private readonly statusChangedAt = new Map<string, number>();
  /** The runtime revision each terminal's process exited at; a relaunch moves past it. */
  private readonly exitedRevisions = new Map<string, number>();

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

  /**
   * Loads the stored workspaces, either taking ownership of them or attaching to them.
   *
   * A remote browser shares the desktop app's terminals rather than owning them, so it must not
   * restart what is already running, invent a default workspace or write the whole set back: the
   * desktop window is the one that decides what those rows say.
   */
  async initialize(): Promise<void> {
    const attaching = this.isAttachedRuntime();
    const [storedWorkspaces, live] = await Promise.all([
      this.repository.list(),
      this.gateway.liveTerminals(),
    ]);
    this.adoptedTerminals.set(new Set(live.keys()));
    const initialWorkspaces = attaching
      ? storedWorkspaces
      : storedWorkspaces.length > 0
        ? this.restartRestoredTerminals(storedWorkspaces, live)
        : // A real first run opens on the guide instead: the sample workspaces pointed at folders
          // that do not exist on this machine, and their Agent terminals resumed session ids that
          // never did either. The browser preview keeps them — a simulated terminal with nothing
          // to show is not a preview of anything.
          hasBackend()
          ? []
          : await loadPreviewWorkspaces();

    const orderedWorkspaces = this.normalizeWorkspaceOrder(initialWorkspaces);
    this.workspaceItems.set(orderedWorkspaces);
    const firstWorkspace = orderedWorkspaces[0];
    this.activeWorkspaceId.set(firstWorkspace?.id ?? null);
    this.activeTerminalId.set(firstWorkspace?.terminals[0]?.id ?? null);

    await this.watchExternalChanges();
    if (attaching) {
      // A reconnect can have missed any number of change events, so the whole set is re-read.
      this.remoteConnection.onReconnected(() => void this.reloadFromRepository());
      return;
    }

    await this.repository.saveAll(orderedWorkspaces);
  }

  /** Re-reads every workspace from the store, discarding whatever this client held. */
  async reloadFromRepository(): Promise<void> {
    const workspaces = this.normalizeWorkspaceOrder(await this.repository.list());
    this.workspaceItems.set(workspaces);
    const activeWorkspace =
      workspaces.find((workspace) => workspace.id === this.activeWorkspaceId()) ??
      workspaces[0] ??
      null;
    this.activeWorkspaceId.set(activeWorkspace?.id ?? null);
    if (!activeWorkspace?.terminals.some((terminal) => terminal.id === this.activeTerminalId())) {
      this.activeTerminalId.set(activeWorkspace?.terminals[0]?.id ?? null);
    }
  }

  /**
   * Applies a workspace another client saved.
   *
   * Deliberately never written back: the change already reached the store, and echoing it would
   * overwrite whatever its author saved in the meantime.
   */
  applyExternalWorkspace(workspace: Workspace): void {
    const workspaces = this.workspaceItems();
    this.recordExternalStatusChanges(
      workspaces.find((item) => item.id === workspace.id),
      workspace,
    );
    const merged = workspaces.some((item) => item.id === workspace.id)
      ? workspaces.map((item) => (item.id === workspace.id ? workspace : item))
      : [...workspaces, workspace];
    const orderedWorkspaces = this.normalizeWorkspaceOrder(
      // A workspace saved without a sort order is appended: the sort is stable, so it keeps the
      // position it was merged into rather than jumping to the front.
      [...merged].sort(
        (left, right) =>
          (left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.sortOrder ?? Number.MAX_SAFE_INTEGER),
      ),
    );
    this.workspaceItems.set(orderedWorkspaces);

    if (!this.activeWorkspaceId()) {
      const firstWorkspace = orderedWorkspaces[0];
      this.activeWorkspaceId.set(firstWorkspace?.id ?? null);
      this.activeTerminalId.set(firstWorkspace?.terminals[0]?.id ?? null);
      return;
    }
    const activeWorkspace = this.activeWorkspace();
    if (
      activeWorkspace?.id === workspace.id &&
      !workspace.terminals.some((terminal) => terminal.id === this.activeTerminalId())
    ) {
      // The other client closed the terminal this one was looking at.
      this.activeTerminalId.set(workspace.terminals[0]?.id ?? null);
    }
  }

  /** Drops a workspace another client deleted, without writing anything back. */
  removeExternalWorkspace(workspaceId: string): void {
    const workspaces = this.workspaceItems();
    const removedIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (removedIndex < 0) {
      return;
    }

    const remainingWorkspaces = this.normalizeWorkspaceOrder(
      workspaces.filter((workspace) => workspace.id !== workspaceId),
    );
    this.workspaceItems.set(remainingWorkspaces);
    if (this.activeWorkspaceId() !== workspaceId) {
      return;
    }

    const nextWorkspace =
      remainingWorkspaces[Math.min(removedIndex, remainingWorkspaces.length - 1)];
    this.activeWorkspaceId.set(nextWorkspace?.id ?? null);
    this.activeTerminalId.set(nextWorkspace?.terminals[0]?.id ?? null);
  }

  selectWorkspace(workspaceId: string): void {
    const workspace = this.workspaceItems().find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    if (this.isAttachedRuntime()) {
      // Persisting `lastOpenedAt` would write the whole row back, clobbering terminal state the
      // desktop window has changed but not yet flushed. Switching views is a local act anyway.
      this.activeWorkspaceId.set(workspaceId);
      this.activeTerminalId.set(workspace.terminals[0]?.id ?? null);
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

  async createWorkspace(name: string, projectPath: string): Promise<Workspace | null> {
    const normalizedName = name.trim();
    const normalizedPath = projectPath.trim();
    if (!normalizedName || !normalizedPath) {
      return null;
    }

    const workspace: Workspace = {
      id: createId(),
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

    // A workspace must exist in storage before a terminal can be launched into it.
    // Keep the current selection intact when the write fails so creation can be retried.
    await this.repository.save(workspace);
    this.workspaceItems.update((items) => [...items, workspace]);
    this.activeWorkspaceId.set(workspace.id);
    this.activeTerminalId.set(null);
    return workspace;
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

  reorderWorkspace(
    workspaceId: string,
    targetWorkspaceId: string,
    position: 'before' | 'after',
  ): boolean {
    const workspaces = [...this.workspaceItems()];
    const currentIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (currentIndex < 0 || workspaceId === targetWorkspaceId) return false;

    const [moved] = workspaces.splice(currentIndex, 1);
    const targetIndex = workspaces.findIndex((workspace) => workspace.id === targetWorkspaceId);
    if (targetIndex < 0) return false;
    const insertIndex = targetIndex + (position === 'after' ? 1 : 0);
    if (insertIndex === currentIndex) return false;

    workspaces.splice(insertIndex, 0, moved);
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

  createTerminal(input: CreateTerminalInput, workspaceId?: string): TerminalSession | null {
    const workspace = workspaceId
      ? (this.workspaceItems().find((item) => item.id === workspaceId) ?? null)
      : this.activeWorkspace();
    if (!workspace) {
      return null;
    }

    const terminal = this.buildTerminal(workspace, input);
    const updatedWorkspace = {
      ...workspace,
      terminals: [...workspace.terminals, terminal],
    };
    this.replaceWorkspace(updatedWorkspace);
    if (this.activeWorkspace()?.id === workspace.id) {
      this.activeTerminalId.set(terminal.id);
    }
    void this.repository.save(updatedWorkspace);
    return terminal;
  }

  closeTerminal(terminalId: string): void {
    const workspace = this.activeWorkspace();
    if (!workspace) {
      return;
    }

    const closedIndex = workspace.terminals.findIndex((terminal) => terminal.id === terminalId);
    const updatedTerminals = workspace.terminals.filter((terminal) => terminal.id !== terminalId);
    const updatedWorkspace = { ...workspace, terminals: updatedTerminals };
    this.replaceWorkspace(updatedWorkspace);

    if (this.activeTerminalId() === terminalId) {
      // Falls through to the neighbour — the tab that slid into the closed one's place, or the
      // one before it at the end of the strip — rather than jumping back to the first tab.
      const neighbour = updatedTerminals[Math.min(closedIndex, updatedTerminals.length - 1)];
      this.activeTerminalId.set(neighbour?.id ?? null);
    }
    void this.repository.save(updatedWorkspace);
  }

  /** Lifts a terminal out of the tab order and drops it back in at `targetIndex`. */
  reorderTerminal(terminalId: string, targetIndex: number): boolean {
    const workspace = this.activeWorkspace();
    if (!workspace) {
      return false;
    }
    const terminals = [...workspace.terminals];
    const currentIndex = terminals.findIndex((terminal) => terminal.id === terminalId);
    if (
      currentIndex < 0 ||
      targetIndex < 0 ||
      targetIndex >= terminals.length ||
      targetIndex === currentIndex
    ) {
      return false;
    }

    terminals.splice(targetIndex, 0, ...terminals.splice(currentIndex, 1));
    const updatedWorkspace = { ...workspace, terminals };
    this.replaceWorkspace(updatedWorkspace);
    void this.repository.save(updatedWorkspace);
    return true;
  }

  moveTerminal(terminalId: string, direction: -1 | 1): boolean {
    const currentIndex = (this.activeWorkspace()?.terminals ?? []).findIndex(
      (terminal) => terminal.id === terminalId,
    );
    return currentIndex >= 0 && this.reorderTerminal(terminalId, currentIndex + direction);
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
    this.recordStatusChange(terminalId, Date.now());
    this.updateTerminal(terminalId, (terminal) => ({ ...terminal, status }));
  }

  /**
   * Records that a terminal's process ended, with the status its exit reported.
   *
   * Hooks keep arriving after the PTY has closed — Antigravity reports idle twice more, Claude's
   * Stop can land late — and none of them may bring a terminal that is gone back to life. They are
   * ignored until the terminal is relaunched, which moves it to a new runtime revision.
   */
  markTerminalExited(terminalId: string, status: 'STOPPED' | 'FAILED'): void {
    const terminal = this.findTerminal(terminalId);
    if (!terminal) {
      return;
    }
    this.exitedRevisions.set(terminalId, terminal.runtimeRevision ?? 0);
    this.updateTerminalStatus(terminalId, status);
  }

  /** Whether the terminal's current launch has exited and has not been relaunched since. */
  hasTerminalExited(terminalId: string): boolean {
    const terminal = this.findTerminal(terminalId);
    return terminal !== undefined && this.isExitedLaunch(terminal);
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
      Pick<
        TerminalSession,
        'model' | 'profileId' | 'mcpProfileId' | 'accountProfileId' | 'nativeSessionId'
      >
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
    this.recordStatusChange(terminalId, Date.now());
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

  /**
   * Whether a hook event no longer describes its terminal and must be ignored by everything that
   * follows terminal state, not just this service.
   *
   * That is the case once the terminal's process has exited, when its status has changed since
   * the event fired, and for a tool starting while an approval is pending: the gated tool's own
   * start fires before its permission request, so a later one belongs to another tool — typically
   * a parallel subagent — and would hide a dialog that is still waiting for the user.
   */
  isSupersededAgentEvent(event: AgentEvent): boolean {
    if (event.createdAt < this.lastStatusChangeAt(event.terminalId)) {
      return true;
    }
    const terminal = this.findTerminal(event.terminalId);
    return (
      terminal !== undefined &&
      (this.isExitedLaunch(terminal) ||
        (terminal.status === 'WAITING_APPROVAL' && event.eventType === TOOL_STARTED_EVENT_TYPE))
    );
  }

  applyAgentEvent(event: AgentEvent): void {
    const status = EVENT_STATUS[event.eventType];
    const workspace = this.workspaceItems().find((item) =>
      item.terminals.some((terminal) => terminal.id === event.terminalId),
    );
    const terminal = workspace?.terminals.find((item) => item.id === event.terminalId);
    if (
      !workspace ||
      !terminal ||
      terminal.agentType !== event.agentType ||
      !status ||
      this.isSupersededAgentEvent(event)
    ) {
      return;
    }

    this.recordStatusChange(terminal.id, event.createdAt);
    const nativeSessionId = event.nativeSessionId ?? terminal.nativeSessionId;
    if (status === terminal.status && nativeSessionId === terminal.nativeSessionId) {
      return;
    }
    const updatedWorkspace = {
      ...workspace,
      terminals: workspace.terminals.map((item) =>
        item.id === event.terminalId ? { ...item, status, nativeSessionId } : item,
      ),
    };
    this.replaceWorkspace(updatedWorkspace);
    // Every client receives the same events, so only the one that owns the workspaces records
    // them. A remote client saving too sent each change back to the desktop as a workspace edit,
    // which replaced newer state there and raised the same notice a second time.
    if (!this.isAttachedRuntime()) {
      void this.repository.save(updatedWorkspace);
    }
  }

  restartTerminalWithProfile(
    terminalId: string,
    command: string,
    changes: TerminalRestartChanges,
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
            model: changes.model,
            profileId: changes.profileId,
            mcpProfileId:
              terminal.agentType === 'claude'
                ? (changes.mcpProfileId ?? terminal.mcpProfileId)
                : undefined,
            accountProfileId: changes.accountProfileId ?? terminal.accountProfileId,
            nativeSessionId: undefined,
            status: 'STARTING' as const,
            runtimeRevision: (terminal.runtimeRevision ?? 0) + 1,
          },
    );
    this.recordStatusChange(terminalId, Date.now());
    this.replaceWorkspace({ ...workspace, terminals });
    void this.repository.save({ ...workspace, terminals });
    return true;
  }

  private findTerminal(terminalId: string): TerminalSession | undefined {
    return this.workspaceItems()
      .flatMap((workspace) => workspace.terminals)
      .find((terminal) => terminal.id === terminalId);
  }

  private isExitedLaunch(terminal: TerminalSession): boolean {
    return this.exitedRevisions.get(terminal.id) === (terminal.runtimeRevision ?? 0);
  }

  /**
   * When the terminal's status last changed, or — before this client has seen it change — the
   * moment from which its events describe the process it is showing. For a terminal restarted on
   * load that is the load itself; one adopted while still running keeps a short grace period.
   */
  private lastStatusChangeAt(terminalId: string): number {
    return (
      this.statusChangedAt.get(terminalId) ??
      (this.isAdoptedTerminal(terminalId)
        ? this.loadedAt - ADOPTED_TERMINAL_EVENT_GRACE_MS
        : this.loadedAt)
    );
  }

  private recordStatusChange(terminalId: string, changedAt: number): void {
    this.statusChangedAt.set(
      terminalId,
      Math.max(changedAt, this.statusChangedAt.get(terminalId) ?? changedAt),
    );
  }

  /**
   * Stamps the statuses another client changed with the moment they arrived.
   *
   * Those changes are the other client's local writes — a submitted prompt, a cleared notice — and
   * an event that fired before them must not undo them here either.
   */
  private recordExternalStatusChanges(current: Workspace | undefined, incoming: Workspace): void {
    const receivedAt = Date.now();
    for (const terminal of incoming.terminals) {
      const known = current?.terminals.find((item) => item.id === terminal.id);
      if (known && known.status !== terminal.status) {
        this.recordStatusChange(terminal.id, receivedAt);
      }
    }
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

  /** True where this client shares another Termexo's workspaces instead of owning them. */
  private isAttachedRuntime(): boolean {
    return runtimeMode() === 'remote';
  }

  private async watchExternalChanges(): Promise<void> {
    this.unwatchWorkspaces?.();
    this.unwatchWorkspaces = await this.repository.watchChanges({
      changed: (workspace) => this.applyExternalWorkspace(workspace),
      deleted: (workspaceId) => this.removeExternalWorkspace(workspaceId),
    });
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
      id: input.id ?? createId(),
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
              ? OPENCODE_DEFAULT_MODEL
              : agentType === 'grok'
                ? 'Grok Build'
                : 'Local'),
      branch: workspace.activeBranch,
      command: input.command ?? this.defaultCommand(agentType),
      nativeSessionId: input.nativeSessionId,
      profileId: input.profileId,
      mcpProfileId: input.mcpProfileId,
      accountProfileId: input.accountProfileId,
      autoConfirm: input.autoConfirm,
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

  /**
   * Restarts the terminals this client is taking ownership of, and adopts the ones already running.
   *
   * Loading is not the same as starting. The backend outlives a reloaded window, so a reload — or
   * a right-click on a menu that still offered Reload — used to arrive here and bump every
   * revision, which `create_terminal` reads as a relaunch and answers by killing the process that
   * was running. A user with a dozen agents mid-task lost all of them to one click. A terminal the
   * backend is still running is therefore left at the launch it is running, so mounting it
   * re-attaches instead.
   */
  private restartRestoredTerminals(
    workspaces: Workspace[],
    live: ReadonlyMap<string, number>,
  ): Workspace[] {
    return workspaces.map((workspace) => ({
      ...workspace,
      terminals: workspace.terminals
        .filter((terminal) => (terminal.agentType as string) !== 'gemini')
        .map((terminal) => {
          const runningRevision = live.get(terminal.id);
          return runningRevision === undefined
            ? {
                ...terminal,
                status: 'STARTING' as const,
                command: terminal.command ?? this.restoredCommand(terminal),
                runtimeRevision: (terminal.runtimeRevision ?? 0) + 1,
              }
            : { ...terminal, runtimeRevision: runningRevision };
        }),
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
