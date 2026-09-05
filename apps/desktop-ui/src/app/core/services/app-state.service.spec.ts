import { TestBed } from '@angular/core/testing';

import { Workspace } from '../models/workspace.models';
import { AppStateService } from './app-state.service';
import { WorkspaceRepository } from './workspace.repository';

describe('AppStateService', () => {
  let service: AppStateService;
  const repository = {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    saveAll: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    watchChanges: vi.fn().mockResolvedValue(() => undefined),
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

  beforeEach(() => {
    vi.clearAllMocks();
    repository.list.mockResolvedValue([]);
    repository.watchChanges.mockResolvedValue(() => undefined);
    TestBed.configureTestingModule({
      providers: [AppStateService, { provide: WorkspaceRepository, useValue: repository }],
    });
    service = TestBed.inject(AppStateService);
  });

  it('creates default workspaces on first launch', async () => {
    await service.initialize();

    expect(service.workspaces().length).toBeGreaterThan(0);
    expect(service.activeWorkspace()?.name).toBe('Termexo');
    expect(service.activeTerminal()?.status).toBe('STARTING');
    expect(repository.saveAll).toHaveBeenCalledOnce();
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
});
