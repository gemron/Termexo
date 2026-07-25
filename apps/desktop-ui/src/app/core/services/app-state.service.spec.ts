import { TestBed } from '@angular/core/testing';

import { AppStateService } from './app-state.service';
import { WorkspaceRepository } from './workspace.repository';

describe('AppStateService', () => {
  let service: AppStateService;
  const repository = {
    list: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
    saveAll: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository.list.mockResolvedValue([]);
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

    const terminal = service.createTerminal({ agentType: 'gemini' });

    expect(terminal?.agentType).toBe('gemini');
    expect(service.activeTerminal()?.id).toBe(terminal?.id);
    expect(repository.save).toHaveBeenCalled();
  });

  it('keeps shell terminals unchanged during model switching', async () => {
    await service.initialize();
    const shell = service.createTerminal({ agentType: 'shell' });

    const switched = service.switchAllModels('gpt-codex');

    expect(switched).toBeGreaterThan(0);
    expect(
      service.activeWorkspace()?.terminals.find((terminal) => terminal.id === shell?.id)?.model,
    ).toBe('Local');
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
});
