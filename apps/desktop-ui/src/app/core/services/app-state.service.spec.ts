import { TestBed } from '@angular/core/testing';

import { AgentEvent, chronologicalAgentEvents } from '../models/agent.models';
import { TerminalStatus, Workspace } from '../models/workspace.models';
import { AppStateService } from './app-state.service';
import { TerminalGatewayService } from './terminal-gateway.service';
import { WorkspaceRepository } from './workspace.repository';

describe('AppStateService', () => {
  let service: AppStateService;
  /** Taken just before the service is created, so every earlier moment predates its load. */
  let createdAfter: number;
  const repository = {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    saveAll: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    watchChanges: vi.fn().mockResolvedValue(() => undefined),
  };
  /** Stands in for the backend's answer about which terminals still have a process. */
  const gateway = {
    liveTerminals: vi.fn().mockResolvedValue(new Map<string, number>()),
  };

  function externalWorkspace(id: string, sortOrder: number): Workspace {
    return {
      id,
      name: `External ${id}`,
      sortOrder,
      projectPath: 'D:\\dev\\external',
      projectType: 'Local project',
      activeBranch: 'main',
      favorite: false,
      lastOpenedAt: Date.now(),
      layout: 'single',
      terminals: [],
    };
  }

  /** The marker the runtime reads to tell the desktop app from the browser preview. */
  const runtime = globalThis as unknown as Record<string, unknown>;

  afterEach(() => {
    delete runtime['__TAURI_INTERNALS__'];
  });

  beforeEach(() => {
    vi.clearAllMocks();
    repository.list.mockResolvedValue([]);
    repository.watchChanges.mockResolvedValue(() => undefined);
    gateway.liveTerminals.mockResolvedValue(new Map<string, number>());
    TestBed.configureTestingModule({
      providers: [
        AppStateService,
        { provide: WorkspaceRepository, useValue: repository },
        { provide: TerminalGatewayService, useValue: gateway },
      ],
    });
    createdAfter = Date.now();
    service = TestBed.inject(AppStateService);
  });

  it('seeds sample workspaces for the browser preview', async () => {
    await service.initialize();

    expect(service.workspaces().length).toBeGreaterThan(0);
    expect(service.activeWorkspace()?.name).toBe('Termexo');
    expect(service.activeTerminal()?.status).toBe('STARTING');
    expect(repository.saveAll).toHaveBeenCalledOnce();
  });

  // The samples pointed at folders that do not exist on the machine running the app, and their
  // Agent terminals resumed session ids that never did either.
  it('opens empty on a first run of the desktop app', async () => {
    runtime['__TAURI_INTERNALS__'] = {};

    await service.initialize();

    expect(service.workspaces()).toEqual([]);
    expect(service.activeWorkspace()).toBeNull();
    expect(service.activeTerminal()).toBeNull();
  });

  it('marks persisted terminals for automatic restart', async () => {
    repository.list.mockResolvedValueOnce([
      {
        id: 'workspace-1',
        name: 'Persisted workspace',
        projectPath: 'D:\\dev\\persisted',
        projectType: 'Local project',
        activeBranch: 'main',
        favorite: false,
        lastOpenedAt: Date.now(),
        layout: 'single',
        terminals: [
          {
            id: 'terminal-1',
            name: 'Old terminal',
            workingDirectory: 'D:\\dev\\persisted',
            shell: 'powershell.exe',
            agentType: 'shell',
            status: 'RUNNING',
            model: 'Local',
            branch: 'main',
            command: 'echo restored',
          },
          {
            id: 'terminal-claude',
            name: 'Claude session',
            workingDirectory: 'D:\\dev\\persisted',
            shell: 'powershell.exe',
            agentType: 'claude',
            status: 'STOPPED',
            model: 'Claude Sonnet',
            branch: 'main',
            nativeSessionId: 'session-123',
          },
        ],
      },
    ]);

    await service.initialize();

    expect(service.activeTerminal()).toEqual(
      expect.objectContaining({
        id: 'terminal-1',
        status: 'STARTING',
        command: 'echo restored',
        workingDirectory: 'D:\\dev\\persisted',
      }),
    );
    expect(repository.saveAll).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'workspace-1',
        terminals: [
          expect.objectContaining({ id: 'terminal-1', status: 'STARTING' }),
          expect.objectContaining({
            id: 'terminal-claude',
            status: 'STARTING',
            command: "claude --resume 'session-123'",
          }),
        ],
      }),
    ]);
  });

  it('adopts a terminal the backend is still running rather than relaunching it', async () => {
    // A reloaded window and a second client both load into a backend whose terminals are still
    // working. Bumping the revision here is what `create_terminal` reads as a relaunch, and it
    // answers by killing the agent that was mid-task.
    repository.list.mockResolvedValueOnce([
      {
        id: 'workspace-1',
        name: 'Persisted workspace',
        projectPath: 'D:\dev\persisted',
        projectType: 'Local project',
        activeBranch: 'main',
        favorite: false,
        lastOpenedAt: Date.now(),
        layout: 'single',
        terminals: [
          {
            id: 'terminal-running',
            name: 'Working agent',
            workingDirectory: 'D:\dev\persisted',
            shell: 'powershell.exe',
            agentType: 'claude',
            status: 'THINKING',
            model: 'Claude Sonnet',
            branch: 'main',
            command: "claude --resume 'session-123'",
            runtimeRevision: 3,
          },
          {
            id: 'terminal-stopped',
            name: 'Closed terminal',
            workingDirectory: 'D:\dev\persisted',
            shell: 'powershell.exe',
            agentType: 'shell',
            status: 'STOPPED',
            model: 'Local',
            branch: 'main',
            command: 'echo restored',
            runtimeRevision: 1,
          },
        ],
      },
    ]);
    gateway.liveTerminals.mockResolvedValue(new Map([['terminal-running', 3]]));

    await service.initialize();

    expect(repository.saveAll).toHaveBeenCalledWith([
      expect.objectContaining({
        terminals: [
          // Left at the launch that is running, and at the status it was left in.
          expect.objectContaining({
            id: 'terminal-running',
            status: 'THINKING',
            runtimeRevision: 3,
          }),
          // Nothing is running for this one, so it still restarts.
          expect.objectContaining({
            id: 'terminal-stopped',
            status: 'STARTING',
            runtimeRevision: 2,
          }),
        ],
      }),
    ]);
    expect(service.isAdoptedTerminal('terminal-running')).toBe(true);
    expect(service.isAdoptedTerminal('terminal-stopped')).toBe(false);
  });

  it('adds a terminal to the active workspace', async () => {
    await service.initialize();

    const terminal = service.createTerminal({ agentType: 'codex', autoConfirm: true });

    expect(terminal?.agentType).toBe('codex');
    expect(terminal?.autoConfirm).toBe(true);
    expect(service.activeTerminal()?.id).toBe(terminal?.id);
    expect(repository.save).toHaveBeenCalled();
  });

  it('adds a task terminal to its requested workspace even after the user switches away', async () => {
    await service.initialize();
    const sourceWorkspace = service.activeWorkspace()!;
    const targetWorkspace = service.workspaces()[1];
    const activeTerminalId = service.activeTerminal()?.id;

    const terminal = service.createTerminal(
      { id: 'task-terminal', agentType: 'codex', name: 'Task terminal' },
      targetWorkspace.id,
    );

    expect(terminal?.id).toBe('task-terminal');
    expect(service.activeWorkspace()?.id).toBe(sourceWorkspace.id);
    expect(service.activeTerminal()?.id).toBe(activeTerminalId);
    expect(
      service
        .workspaces()
        .find((workspace) => workspace.id === targetWorkspace.id)
        ?.terminals.some((item) => item.id === terminal?.id),
    ).toBe(true);
  });

  it('persists normalized custom grid dimensions for the active workspace', async () => {
    await service.initialize();

    service.setGridDimensions(3, 8);

    expect(service.activeWorkspace()).toEqual(
      expect.objectContaining({
        layout: 'grid',
        gridColumns: 3,
        gridRows: 6,
      }),
    );
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        layout: 'grid',
        gridColumns: 3,
        gridRows: 6,
      }),
    );
  });

  it('renames a workspace and persists its normalized theme color', async () => {
    await service.initialize();
    const workspaceId = service.activeWorkspace()!.id;

    const updated = service.updateWorkspaceAppearance(workspaceId, '  Termexo Cloud  ', '#A78BFA');

    expect(updated).toBe(true);
    expect(service.activeWorkspace()).toEqual(
      expect.objectContaining({
        name: 'Termexo Cloud',
        themeColor: '#a78bfa',
      }),
    );
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: workspaceId,
        name: 'Termexo Cloud',
        themeColor: '#a78bfa',
      }),
    );
  });

  it('keeps the workspace order stable when selecting another workspace', async () => {
    await service.initialize();
    const workspaceIds = service.workspaces().map((workspace) => workspace.id);

    service.selectWorkspace(workspaceIds.at(-1)!);

    expect(service.workspaces().map((workspace) => workspace.id)).toEqual(workspaceIds);
  });

  it('updates a running terminal after its workspace becomes inactive', async () => {
    await service.initialize();
    const terminal = service.createTerminal({ agentType: 'claude' })!;
    const terminalWorkspaceId = service.activeWorkspace()!.id;
    const inactiveWorkspaceId = service.workspaces().at(-1)!.id;

    service.selectWorkspace(inactiveWorkspaceId);
    service.updateTerminalStatus(terminal.id, 'COMPLETED');

    expect(service.activeWorkspace()?.id).toBe(inactiveWorkspaceId);
    expect(
      service
        .workspaces()
        .find((workspace) => workspace.id === terminalWorkspaceId)
        ?.terminals.find((item) => item.id === terminal.id)?.status,
    ).toBe('COMPLETED');
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: terminalWorkspaceId }),
    );
  });

  it('replaces a restored Codex command before the terminal runtime is mounted', async () => {
    await service.initialize();
    const terminal = service.createTerminal({
      agentType: 'codex',
      command: "codex --model 'gpt-5.6-sol'",
    })!;

    const updated = service.updateRestoredTerminalLaunch(
      terminal.id,
      "codex -c 'notify=[...]' --model 'gpt-5.6-sol'",
    );

    expect(updated).toBe(true);
    expect(service.activeTerminal()).toEqual(
      expect.objectContaining({
        id: terminal.id,
        command: "codex -c 'notify=[...]' --model 'gpt-5.6-sol'",
        status: 'STARTING',
      }),
    );
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminals: expect.arrayContaining([
          expect.objectContaining({ id: terminal.id, command: expect.stringContaining('notify') }),
        ]),
      }),
    );
  });

  it('persists the resolved model profile when refreshing a restored Claude launch', async () => {
    await service.initialize();
    const terminal = service.createTerminal({
      agentType: 'claude',
      command: "claude --model 'sonnet'",
      nativeSessionId: 'legacy-session',
    })!;

    const updated = service.updateRestoredTerminalLaunch(
      terminal.id,
      "claude --model 'MiniMax-M3' --resume 'legacy-session'",
      { profileId: 'claude-default', model: 'MiniMax M3' },
    );

    expect(updated).toBe(true);
    expect(service.activeTerminal()).toEqual(
      expect.objectContaining({
        id: terminal.id,
        command: "claude --model 'MiniMax-M3' --resume 'legacy-session'",
        model: 'MiniMax M3',
        profileId: 'claude-default',
        nativeSessionId: 'legacy-session',
        status: 'STARTING',
      }),
    );
    expect(repository.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminals: expect.arrayContaining([
          expect.objectContaining({
            id: terminal.id,
            model: 'MiniMax M3',
            profileId: 'claude-default',
          }),
        ]),
      }),
    );
  });

  it('moves a workspace manually and persists the new order', async () => {
    await service.initialize();
    repository.saveAll.mockClear();
    const workspaceIds = service.workspaces().map((workspace) => workspace.id);

    const moved = service.moveWorkspace(workspaceIds[2], -1);

    expect(moved).toBe(true);
    expect(service.workspaces().map((workspace) => workspace.id)).toEqual([
      workspaceIds[0],
      workspaceIds[2],
      workspaceIds[1],
    ]);
    expect(service.workspaces().map((workspace) => workspace.sortOrder)).toEqual([0, 1, 2]);
    expect(repository.saveAll).toHaveBeenCalledWith(
      service.workspaces().map((workspace) => expect.objectContaining({ id: workspace.id })),
    );
  });

  it('inserts a dragged workspace at the requested position and persists it', async () => {
    await service.initialize();
    repository.saveAll.mockClear();
    const ids = service.workspaces().map((workspace) => workspace.id);

    expect(service.reorderWorkspace(ids[2], ids[0], 'before')).toBe(true);
    expect(service.workspaces().map((workspace) => workspace.id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);
    expect(service.workspaces().map((workspace) => workspace.sortOrder)).toEqual([0, 1, 2]);
    expect(repository.saveAll).toHaveBeenCalledWith(service.workspaces());

    repository.saveAll.mockClear();
    expect(service.reorderWorkspace(ids[2], ids[0], 'before')).toBe(false);
    expect(repository.saveAll).not.toHaveBeenCalled();
  });

  it('deletes a workspace and selects a remaining workspace', async () => {
    await service.initialize();
    const deletedWorkspace = service.activeWorkspace()!;

    const removed = await service.deleteWorkspace(deletedWorkspace.id);

    expect(removed?.id).toBe(deletedWorkspace.id);
    expect(service.workspaces().some((workspace) => workspace.id === deletedWorkspace.id)).toBe(
      false,
    );
    expect(service.activeWorkspace()).not.toBeNull();
    expect(repository.delete).toHaveBeenCalledWith(deletedWorkspace.id);
  });

  it('keeps a workspace when persistent deletion fails', async () => {
    await service.initialize();
    const workspace = service.activeWorkspace()!;
    repository.delete.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.deleteWorkspace(workspace.id)).rejects.toThrow('database unavailable');

    expect(service.workspaces().some((item) => item.id === workspace.id)).toBe(true);
    expect(service.activeWorkspace()?.id).toBe(workspace.id);
  });

  it('merges terminals into a target workspace and removes the source workspace', async () => {
    await service.initialize();
    const sourceWorkspace = service.activeWorkspace()!;
    const sourceTerminalIds = sourceWorkspace.terminals.map((terminal) => terminal.id);
    const sourceActiveTerminalId = service.activeTerminal()!.id;
    const targetWorkspace = service.workspaces()[1];
    service.selectWorkspace(targetWorkspace.id);
    const targetTerminal = service.createTerminal({ agentType: 'shell', name: 'Target shell' })!;
    service.selectWorkspace(sourceWorkspace.id);
    repository.saveAll.mockClear();
    repository.delete.mockClear();

    const merged = await service.mergeWorkspaces(sourceWorkspace.id, targetWorkspace.id);

    expect(merged?.id).toBe(targetWorkspace.id);
    expect(merged?.terminals.map((terminal) => terminal.id)).toEqual([
      targetTerminal.id,
      ...sourceTerminalIds,
    ]);
    expect(service.workspaces().some((workspace) => workspace.id === sourceWorkspace.id)).toBe(
      false,
    );
    expect(service.activeWorkspace()?.id).toBe(targetWorkspace.id);
    expect(service.activeTerminal()?.id).toBe(sourceActiveTerminalId);
    expect(service.workspaces().map((workspace) => workspace.sortOrder)).toEqual([0, 1]);
    expect(repository.saveAll).toHaveBeenCalledOnce();
    expect(repository.delete).toHaveBeenCalledWith(sourceWorkspace.id);
  });

  it('keeps both workspaces when a merge cannot delete the source', async () => {
    await service.initialize();
    const originalWorkspaces = service.workspaces();
    const sourceWorkspace = originalWorkspaces[0];
    const targetWorkspace = originalWorkspaces[1];
    repository.delete.mockRejectedValueOnce(new Error('database unavailable'));
    repository.saveAll.mockClear();

    await expect(service.mergeWorkspaces(sourceWorkspace.id, targetWorkspace.id)).rejects.toThrow(
      'database unavailable',
    );

    expect(service.workspaces()).toEqual(originalWorkspaces);
    expect(service.activeWorkspace()?.id).toBe(sourceWorkspace.id);
    expect(repository.saveAll).toHaveBeenCalledTimes(2);
    expect(repository.saveAll).toHaveBeenLastCalledWith(originalWorkspaces);
  });

  it('restarts a Claude terminal with a new profile without changing the CLI type', async () => {
    await service.initialize();
    const shell = service.createTerminal({ agentType: 'shell' });
    const claude = service.createTerminal({
      agentType: 'claude',
      command: 'claude --model sonnet',
      profileId: 'claude-default',
      nativeSessionId: 'old-session',
    });

    const switched = service.restartTerminalWithProfile(
      claude!.id,
      "claude --model 'deepseek-v4-pro[1m]'",
      { model: 'DeepSeek V4 Pro', profileId: 'deepseek' },
    );

    expect(switched).toBe(true);
    expect(
      service.activeWorkspace()?.terminals.find((terminal) => terminal.id === claude?.id),
    ).toEqual(
      expect.objectContaining({
        agentType: 'claude',
        command: "claude --model 'deepseek-v4-pro[1m]'",
        model: 'DeepSeek V4 Pro',
        profileId: 'deepseek',
        nativeSessionId: undefined,
        runtimeRevision: 1,
        status: 'STARTING',
      }),
    );
    expect(
      service.activeWorkspace()?.terminals.find((terminal) => terminal.id === shell?.id)?.model,
    ).toBe('Local');
  });

  it('restarts a terminal on another account, keeping the model it was already running', async () => {
    await service.initialize();
    const claude = service.createTerminal({
      agentType: 'claude',
      command: 'claude --model sonnet',
      profileId: 'claude-default',
      accountProfileId: 'claude-system',
      nativeSessionId: 'old-session',
    });

    const switched = service.restartTerminalWithProfile(claude!.id, 'claude --model sonnet', {
      model: 'Claude Sonnet',
      profileId: 'claude-default',
      accountProfileId: 'claude-work',
    });

    expect(switched).toBe(true);
    expect(
      service.activeWorkspace()?.terminals.find((terminal) => terminal.id === claude?.id),
    ).toEqual(
      expect.objectContaining({
        accountProfileId: 'claude-work',
        model: 'Claude Sonnet',
        profileId: 'claude-default',
        // The account owns the transcript directory, so the old session cannot carry over.
        nativeSessionId: undefined,
        runtimeRevision: 1,
      }),
    );
  });

  it('keeps the account a terminal is signed in as when only its model changes', async () => {
    await service.initialize();
    const claude = service.createTerminal({
      agentType: 'claude',
      command: 'claude --model sonnet',
      accountProfileId: 'claude-work',
    });

    service.restartTerminalWithProfile(claude!.id, 'claude --model opus', {
      model: 'Claude Opus',
      profileId: 'anthropic',
    });

    expect(
      service.activeWorkspace()?.terminals.find((terminal) => terminal.id === claude?.id)
        ?.accountProfileId,
    ).toBe('claude-work');
  });

  it('moves terminal tabs manually and persists the new order', async () => {
    await service.initialize();
    const first = service.createTerminal({ agentType: 'shell', name: 'First' })!;
    const second = service.createTerminal({ agentType: 'codex', name: 'Second' })!;
    repository.save.mockClear();

    const moved = service.moveTerminal(second.id, -1);

    expect(moved).toBe(true);
    const ids = service.activeWorkspace()!.terminals.map((terminal) => terminal.id);
    expect(ids.indexOf(second.id)).toBe(ids.indexOf(first.id) - 1);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        terminals: expect.arrayContaining([
          expect.objectContaining({ id: first.id }),
          expect.objectContaining({ id: second.id }),
        ]),
      }),
    );
  });

  it('drops a dragged tab at its target position and rejects a no-op drop', async () => {
    await service.initialize();
    const first = service.createTerminal({ agentType: 'shell', name: 'First' })!;
    const second = service.createTerminal({ agentType: 'codex', name: 'Second' })!;
    const third = service.createTerminal({ agentType: 'claude', name: 'Third' })!;
    const count = service.activeWorkspace()!.terminals.length;

    expect(service.reorderTerminal(first.id, count - 1)).toBe(true);
    expect(
      service
        .activeWorkspace()!
        .terminals.slice(-3)
        .map((terminal) => terminal.id),
    ).toEqual([second.id, third.id, first.id]);

    expect(service.reorderTerminal(first.id, count - 1)).toBe(false);
    expect(service.reorderTerminal(first.id, count)).toBe(false);
  });

  it('activates the neighbouring tab when the active terminal is closed', async () => {
    await service.initialize();
    const first = service.createTerminal({ agentType: 'shell', name: 'First' })!;
    const second = service.createTerminal({ agentType: 'codex', name: 'Second' })!;
    const third = service.createTerminal({ agentType: 'claude', name: 'Third' })!;

    service.selectTerminal(second.id);
    service.closeTerminal(second.id);
    expect(service.activeTerminal()?.id).toBe(third.id);

    // Closing the last tab has no tab to its right, so the one before it takes over.
    service.closeTerminal(third.id);
    expect(service.activeTerminal()?.id).toBe(first.id);
  });

  it('applies Claude hook events to the matching terminal', async () => {
    await service.initialize();
    const terminal = service.createTerminal({
      id: 'terminal-claude',
      agentType: 'claude',
    });

    service.applyAgentEvent({
      eventKey: 'event-1',
      agentType: 'claude',
      terminalId: 'terminal-claude',
      nativeSessionId: 'session-1',
      eventType: 'approval.required',
      detail: {},
      createdAt: Date.now(),
    });

    expect(terminal?.id).toBe('terminal-claude');
    expect(service.activeTerminal()?.status).toBe('WAITING_APPROVAL');
    expect(service.activeTerminal()?.nativeSessionId).toBe('session-1');
  });

  it('binds an OpenCode terminal to the native session reported by its plugin', async () => {
    await service.initialize();
    service.createTerminal({
      id: 'terminal-opencode',
      agentType: 'opencode',
    });

    service.applyAgentEvent({
      eventKey: 'event-opencode-1',
      agentType: 'opencode',
      terminalId: 'terminal-opencode',
      nativeSessionId: 'ses_opencode',
      eventType: 'user.input.required',
      detail: { source: 'question.asked' },
      createdAt: Date.now(),
    });

    expect(service.activeTerminal()?.status).toBe('WAITING_INPUT');
    expect(service.activeTerminal()?.nativeSessionId).toBe('ses_opencode');
  });

  it('ignores hook events from a different Agent even when the terminal ID matches', async () => {
    await service.initialize();
    service.createTerminal({ id: 'terminal-codex', agentType: 'codex' });

    service.applyAgentEvent({
      eventKey: 'event-claude',
      agentType: 'claude',
      terminalId: 'terminal-codex',
      nativeSessionId: 'claude-session',
      eventType: 'task.completed',
      detail: {},
      createdAt: Date.now(),
    });

    expect(service.activeTerminal()?.status).toBe('STARTING');
    expect(service.activeTerminal()?.nativeSessionId).toBeUndefined();
  });

  it('applies a workspace another client saved without writing it back', async () => {
    await service.initialize();
    const existingCount = service.workspaces().length;
    repository.save.mockClear();
    repository.saveAll.mockClear();

    service.applyExternalWorkspace(externalWorkspace('external-1', 99));

    expect(service.workspaces()).toHaveLength(existingCount + 1);
    expect(service.workspaces().at(-1)?.id).toBe('external-1');
    // Sort order is renormalized locally; echoing the change back would overwrite its author.
    expect(service.workspaces().map((workspace) => workspace.sortOrder)).toEqual(
      service.workspaces().map((_, index) => index),
    );
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.saveAll).not.toHaveBeenCalled();
  });

  it('drops a workspace another client deleted without writing it back', async () => {
    await service.initialize();
    const removedId = service.workspaces()[0].id;
    const survivingId = service.workspaces()[1].id;
    repository.save.mockClear();
    repository.saveAll.mockClear();
    repository.delete.mockClear();

    service.removeExternalWorkspace(removedId);

    expect(service.workspaces().some((workspace) => workspace.id === removedId)).toBe(false);
    expect(service.activeWorkspace()?.id).toBe(survivingId);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.saveAll).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('subscribes to workspace changes made outside this client', async () => {
    await service.initialize();

    expect(repository.watchChanges).toHaveBeenCalledOnce();
  });

  describe('hook event ordering', () => {
    const terminalId = 'terminal-claude';
    /** A moment after the service loaded, from which each test lays out its own timeline. */
    let base: number;

    function hookEvent(
      eventType: string,
      createdAt: number,
      eventTerminalId = terminalId,
    ): AgentEvent {
      return {
        eventKey: `${eventTerminalId}:${eventType}:${createdAt}`,
        agentType: 'claude',
        terminalId: eventTerminalId,
        eventType,
        detail: {},
        createdAt,
      };
    }

    function statusOf(id = terminalId): TerminalStatus | undefined {
      return service
        .workspaces()
        .flatMap((workspace) => workspace.terminals)
        .find((terminal) => terminal.id === id)?.status;
    }

    /** Runs a local write, such as the user pressing Enter, at a chosen moment. */
    function atTime(time: number, write: () => void): void {
      vi.setSystemTime(time);
      write();
    }

    beforeEach(async () => {
      base = Date.now() + 1_000;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(base);
      await service.initialize();
      service.createTerminal({ id: terminalId, agentType: 'claude' });
    });

    afterEach(() => {
      vi.useRealTimers();
      document.querySelectorAll('meta[name="termexo-remote"]').forEach((node) => node.remove());
    });

    it('applies a batch by when each hook fired, whatever order it arrived in', () => {
      const batch = [
        hookEvent('approval.required', base + 2_000),
        hookEvent('tool.completed', base + 1_500),
      ];

      for (const event of chronologicalAgentEvents(batch)) {
        service.applyAgentEvent(event);
      }

      expect(statusOf()).toBe('WAITING_APPROVAL');
    });

    it('ignores an event that fired before the status it would replace', () => {
      service.applyAgentEvent(hookEvent('approval.required', base + 5_000));
      const late = hookEvent('tool.completed', base + 4_000);

      expect(service.isSupersededAgentEvent(late)).toBe(true);
      service.applyAgentEvent(late);

      expect(statusOf()).toBe('WAITING_APPROVAL');
    });

    it('keeps a local write over a hook that fired before it, and applies later ones at once', () => {
      // The user answers the prompt; the permission request drained afterwards is already settled.
      atTime(base + 3_000, () => service.updateTerminalStatus(terminalId, 'THINKING'));
      service.applyAgentEvent(hookEvent('approval.required', base + 2_500));
      expect(statusOf()).toBe('THINKING');

      service.applyAgentEvent(hookEvent('approval.required', base + 3_500));
      expect(statusOf()).toBe('WAITING_APPROVAL');
    });

    it('keeps a pending approval visible while another tool starts', () => {
      service.applyAgentEvent(hookEvent('approval.required', base + 1_000));
      // A parallel subagent's PreToolUse: the gated tool's own start fired before its request.
      service.applyAgentEvent(hookEvent('tool.started', base + 1_400));
      expect(statusOf()).toBe('WAITING_APPROVAL');

      atTime(base + 2_000, () => service.updateTerminalStatus(terminalId, 'THINKING'));
      service.applyAgentEvent(hookEvent('tool.started', base + 2_100));
      expect(statusOf()).toBe('RUNNING');
    });

    it('ignores hooks that arrive after the process exited, until the terminal is relaunched', () => {
      service.applyAgentEvent(hookEvent('agent.thinking', base + 500));
      atTime(base + 1_000, () => service.markTerminalExited(terminalId, 'FAILED'));

      // Antigravity reports idle twice after its PTY closed; Claude's Stop can also land late.
      service.applyAgentEvent(hookEvent('task.completed', base + 1_400));
      service.applyAgentEvent(hookEvent('task.completed', base + 2_500));
      expect(statusOf()).toBe('FAILED');
      expect(service.hasTerminalExited(terminalId)).toBe(true);

      atTime(base + 3_000, () =>
        service.restartTerminalWithProfile(terminalId, 'claude', { model: 'sonnet' }),
      );
      expect(service.hasTerminalExited(terminalId)).toBe(false);
      service.applyAgentEvent(hookEvent('session.ready', base + 4_000));
      expect(statusOf()).toBe('IDLE');
    });

    it('writes a hook status only when it changes the terminal', () => {
      repository.save.mockClear();

      service.applyAgentEvent(hookEvent('tool.started', base + 1_000));
      service.applyAgentEvent(hookEvent('tool.started', base + 1_100));
      expect(repository.save).toHaveBeenCalledOnce();

      service.applyAgentEvent(hookEvent('tool.completed', base + 1_200));
      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(statusOf()).toBe('THINKING');
    });

    it('keeps hook statuses in memory on a remote client, leaving the record to the desktop', () => {
      const marker = document.createElement('meta');
      marker.setAttribute('name', 'termexo-remote');
      marker.setAttribute('content', JSON.stringify({ version: '0.0.0', secure: true }));
      document.head.append(marker);
      repository.save.mockClear();

      service.applyAgentEvent(hookEvent('approval.required', base + 1_000));

      expect(statusOf()).toBe('WAITING_APPROVAL');
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('does not let an older hook undo a status another client changed', () => {
      service.applyAgentEvent(hookEvent('approval.required', base + 1_000));
      const workspace = service
        .workspaces()
        .find((item) => item.terminals.some((terminal) => terminal.id === terminalId))!;

      atTime(base + 5_000, () =>
        service.applyExternalWorkspace({
          ...workspace,
          terminals: workspace.terminals.map((terminal) =>
            terminal.id === terminalId ? { ...terminal, status: 'THINKING' } : terminal,
          ),
        }),
      );
      service.applyAgentEvent(hookEvent('approval.required', base + 3_000));

      expect(statusOf()).toBe('THINKING');
    });
  });

  describe('hook events around a reload', () => {
    function persistedTerminal(id: string, status: TerminalStatus, runtimeRevision: number) {
      return {
        id,
        name: id,
        workingDirectory: 'D:\\dev\\persisted',
        shell: 'powershell.exe',
        agentType: 'claude' as const,
        status,
        model: 'Claude Sonnet',
        branch: 'main',
        runtimeRevision,
      };
    }

    function reloadEvent(terminalId: string, eventType: string, createdAt: number): AgentEvent {
      return {
        eventKey: `${terminalId}:${eventType}:${createdAt}`,
        agentType: 'claude',
        terminalId,
        eventType,
        detail: {},
        createdAt,
      };
    }

    function statusOf(id: string): TerminalStatus | undefined {
      return service
        .workspaces()
        .flatMap((workspace) => workspace.terminals)
        .find((terminal) => terminal.id === id)?.status;
    }

    beforeEach(async () => {
      repository.list.mockResolvedValueOnce([
        {
          id: 'workspace-1',
          name: 'Persisted workspace',
          projectPath: 'D:\\dev\\persisted',
          projectType: 'Local project',
          activeBranch: 'main',
          favorite: false,
          lastOpenedAt: Date.now(),
          layout: 'single',
          terminals: [
            persistedTerminal('terminal-running', 'THINKING', 3),
            persistedTerminal('terminal-restored', 'COMPLETED', 1),
          ],
        },
      ]);
      gateway.liveTerminals.mockResolvedValue(new Map([['terminal-running', 3]]));
      await service.initialize();
    });

    it('drops what the previous process of a restarted terminal reported', () => {
      service.applyAgentEvent(reloadEvent('terminal-restored', 'task.completed', createdAfter - 1));

      expect(statusOf('terminal-restored')).toBe('STARTING');
    });

    it('still applies what a terminal that kept running reported while no window listened', () => {
      // Long before the reload: already reflected in the status that was saved.
      service.applyAgentEvent(
        reloadEvent('terminal-running', 'task.completed', createdAfter - 60_000),
      );
      expect(statusOf('terminal-running')).toBe('THINKING');

      service.applyAgentEvent(
        reloadEvent('terminal-running', 'approval.required', createdAfter - 1_000),
      );
      expect(statusOf('terminal-running')).toBe('WAITING_APPROVAL');
    });
  });
});
