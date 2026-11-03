import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppStateService } from './app-state.service';
import { CommonActionsService, validateCommonAction } from './common-actions.service';
import { TerminalGatewayService } from './terminal-gateway.service';
import { WorkspaceRepository } from './workspace.repository';
import type { Workspace } from '../models/workspace.models';

const draft = {
  name: '前端',
  command: 'npm run dev',
  workingDirectory: 'D:/项目 with spaces/web',
  description: 'package.json scripts.dev',
};

describe('CommonActionsService confirmation and execution boundaries', () => {
  let service: CommonActionsService;
  let state: AppStateService;
  const repository = {
    list: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    saveAll: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    watchChanges: vi.fn().mockResolvedValue(() => undefined),
  };
  const gateway = { liveTerminals: vi.fn(), start: vi.fn(), close: vi.fn() };

  afterEach(() => {
    document.querySelectorAll('meta[name="termexo-remote"]').forEach((item) => item.remove());
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.clear();
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    repository.list.mockResolvedValue([
      {
        id: 'w',
        name: 'Project',
        projectPath: 'D:/项目 with spaces',
        projectType: '',
        activeBranch: '',
        favorite: false,
        lastOpenedAt: 0,
        layout: 'single',
        terminals: [],
      } satisfies Workspace,
    ]);
    gateway.liveTerminals.mockResolvedValue(new Map());
    gateway.start.mockResolvedValue({ attached: false, runtimeRevision: 0, cols: 120, rows: 30 });
    gateway.close.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: WorkspaceRepository, useValue: repository },
        { provide: TerminalGatewayService, useValue: gateway },
      ],
    });
    state = TestBed.inject(AppStateService);
    await state.initialize();
    service = TestBed.inject(CommonActionsService);
    repository.save.mockClear();
  });

  it('saves separate environment variants and launches each from its own working directory', async () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    await service.save('w', { ...draft, id: 'dev', environment: { PORT: '4300', VALUE: '$HOME = literal' } });
    await service.save('w', { ...draft, id: 'test', environment: { PORT: '4400' } });
    expect(state.activeWorkspace()?.commonActions).toHaveLength(2);
    const id = await service.run('w', 'dev');
    const terminal = state.activeWorkspace()!.terminals.find((item) => item.id === id)!;
    expect(terminal.workingDirectory).toBe(draft.workingDirectory);
    expect(terminal.environment).toEqual({ PORT: '4300', VALUE: '$HOME = literal' });
    expect(gateway.start).toHaveBeenCalledWith(expect.objectContaining({ id: terminal.id,
      workingDirectory: terminal.workingDirectory, environment: terminal.environment }), expect.any(Number), expect.any(Number), 'w');
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({
      terminals: expect.arrayContaining([expect.objectContaining({ environment: terminal.environment })]),
    }));
  });

  it('stages editable proposals without saving or starting, and persists only selected validated items after confirmation', async () => {
    const requestId = service.beginRecognition('w');
    const review = service.propose(
      'w',
      requestId,
      JSON.stringify([draft, { ...draft, name: '后端', command: 'npm run server' }]),
    );
    expect(state.activeWorkspace()?.commonActions).toBeUndefined();
    expect(repository.save).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
    service.editSuggestion('w', review.suggestions[0].id, { command: 'pnpm dev' });
    service.editSuggestion('w', review.suggestions[1].id, { selected: false });
    await service.confirm('w');
    expect(state.activeWorkspace()?.commonActions).toHaveLength(1);
    expect(state.activeWorkspace()?.commonActions?.[0].command).toBe('pnpm dev');
    expect(service.reviews()['w']).toBeUndefined();
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it('keeps automatically identified directories and environments from AI review through confirmation and launch', async () => {
    const requestId = service.beginRecognition('w');
    const review = service.propose('w', requestId, JSON.stringify([
      { name: 'Web', command: 'pnpm dev', workingDirectory: './web', environment: { NODE_ENV: 'development', PORT: '4300' }, description: 'README and package.json' },
      { name: 'Build', command: 'pnpm build' },
    ]));
    expect(review.suggestions[0]).toMatchObject({ workingDirectory: 'D:/项目 with spaces/web', environment: { NODE_ENV: 'development', PORT: '4300' } });
    expect(review.suggestions[1]).toMatchObject({ workingDirectory: 'D:/项目 with spaces', environment: {} });
    expect(repository.save).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
    await service.confirm('w');
    const saved = state.activeWorkspace()!.commonActions![0];
    expect(saved).toMatchObject({ workingDirectory: 'D:/项目 with spaces/web', environment: { NODE_ENV: 'development', PORT: '4300' } });
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    await service.run('w', saved.id);
    expect(gateway.start).toHaveBeenCalledWith(expect.objectContaining({ workingDirectory: saved.workingDirectory, environment: saved.environment }), 120, 30, 'w');
  });

  it('rejects cancelled or stale requests, invalid payloads and blank selections without side effects', async () => {
    const first = service.beginRecognition('w');
    service.discard('w');
    expect(() => service.propose('w', first, JSON.stringify([draft]))).toThrow();
    const current = service.beginRecognition('w');
    expect(() => service.propose('w', first, '[]')).toThrow();
    expect(() => service.propose('w', current, '{}')).toThrow();
    expect(() =>
      service.propose('w', current, JSON.stringify([{ ...draft, command: '' }])),
    ).toThrow();
    const review = service.propose('w', current, JSON.stringify([draft]));
    service.editSuggestion('w', review.suggestions[0].id, { selected: false });
    await expect(service.confirm('w')).rejects.toThrow();
    expect(repository.save).not.toHaveBeenCalled();
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it('deduplicates confirmed commands and ignores AI supplied IDs and runtime bindings', async () => {
    const requestId = service.beginRecognition('w');
    service.propose(
      'w',
      requestId,
      JSON.stringify([{ ...draft, id: 'fake', terminalId: 'agent' }, draft]),
    );
    await service.confirm('w');
    expect(state.activeWorkspace()?.commonActions).toHaveLength(1);
    const saved = state.activeWorkspace()!.commonActions![0];
    expect(saved.id).not.toBe('fake');
    expect(saved.terminalId).toBeUndefined();
  });

  it('starts in its own shell, focuses an existing run, and stops/restarts using the terminal gateway', async () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    await service.save('w', { ...draft, id: 'frontend' });
    const id = await service.run('w', 'frontend');
    expect(gateway.start).toHaveBeenCalledWith(
      expect.objectContaining({
        id,
        agentType: 'shell',
        commonActionId: 'frontend',
        command: draft.command,
        workingDirectory: draft.workingDirectory,
      }),
      120,
      30,
      'w',
    );
    gateway.liveTerminals.mockResolvedValue(new Map([[id, 0]]));
    expect(await service.run('w', 'frontend')).toBe(id);
    expect(gateway.start).toHaveBeenCalledTimes(1);
    await service.stop('w', 'frontend');
    expect(gateway.close).toHaveBeenCalledWith(id);
    expect(state.activeWorkspace()?.terminals[0].status).toBe('STOPPED');
    gateway.liveTerminals.mockResolvedValue(new Map());
    gateway.close.mockRejectedValue(new Error('terminal not found'));
    repository.list.mockResolvedValue(state.workspaces());
    await state.initialize();
    await service.stop('w', 'frontend');
    const next = await service.run('w', 'frontend', true);
    expect(gateway.close).toHaveBeenCalledTimes(1);
    expect(next).not.toBe(id);
    expect(state.activeWorkspace()?.terminals).toHaveLength(1);
    expect(state.activeWorkspace()?.commonActions?.[0].terminalId).toBe(next);
  });

  it('does not auto restart a saved project command when restoring workspaces', async () => {
    await service.save('w', { ...draft, id: 'frontend' });
    state.createTerminal({
      agentType: 'shell',
      commonActionId: 'frontend',
      command: draft.command,
    });
    repository.list.mockResolvedValue(state.workspaces());
    await state.initialize();
    expect(state.activeWorkspace()?.terminals[0].status).toBe('STOPPED');
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it('never starts a stopped command when a remote viewer attaches, but adopts live command terminals', async () => {
    state.createTerminal({
      agentType: 'shell',
      commonActionId: 'frontend',
      command: draft.command,
    });
    const terminal = state.activeWorkspace()!.terminals[0];
    repository.list.mockResolvedValue(state.workspaces());
    const marker = document.createElement('meta');
    marker.name = 'termexo-remote';
    marker.content = '{"version":"test","secure":true}';
    document.head.append(marker);
    await state.initialize();
    expect(state.activeWorkspace()?.terminals[0].status).toBe('STOPPED');
    repository.list.mockResolvedValue(state.workspaces());
    gateway.liveTerminals.mockResolvedValue(new Map([[terminal.id, 7]]));
    await state.initialize();
    expect(state.activeWorkspace()?.terminals[0]).toMatchObject({
      status: 'RUNNING',
      runtimeRevision: 7,
    });
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it('cleans up a failed launch and releases its project lock', async () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    await service.save('w', { ...draft, id: 'frontend' });
    gateway.start.mockRejectedValueOnce(new Error('bad cwd'));
    await expect(service.run('w', 'frontend')).rejects.toThrow('bad cwd');
    expect(state.activeWorkspace()?.terminals).toHaveLength(0);
    expect(service.busy().size).toBe(0);
    expect(state.activeWorkspace()?.commonActions?.[0].terminalId).toBeUndefined();
  });

  it('refuses control characters and relative working directories', () => {
    expect(() => validateCommonAction({ ...draft, command: 'npm dev\nrm file' })).toThrow();
    expect(() => validateCommonAction({ ...draft, workingDirectory: './web' })).toThrow();
    expect(
      validateCommonAction({ ...draft, workingDirectory: 'D:\\code dir' }).workingDirectory,
    ).toBe('D:\\code dir');
  });

  it('keeps a single pending recognition and ignores late phase updates after cancellation', () => {
    const requestId = service.beginRecognition('w', 'agent', 'starting');
    expect(() => service.beginRecognition('w', 'agent')).toThrow('正在识别');
    service.updateRecognition('w', requestId, { phase: 'reading' });
    expect(service.reviews()['w']).toMatchObject({
      terminalId: 'agent',
      phase: 'reading',
      waiting: true,
    });
    service.discard('w');
    service.updateRecognition('w', requestId, { waiting: false, error: 'late error' });
    expect(service.reviews()['w']).toBeUndefined();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('shows only new unique suggestions while keeping their source Agent for progress navigation', async () => {
    await service.save('w', { ...draft, id: 'saved' });
    const requestId = service.beginRecognition('w', 'agent');
    const next = { ...draft, command: 'npm test' };
    const review = service.propose('w', requestId, JSON.stringify([draft, next, next]));
    expect(review.suggestions).toHaveLength(1);
    expect(review.duplicateCount).toBe(2);
    expect(review.terminalId).toBe('agent');
    expect(state.activeWorkspace()?.commonActions).toHaveLength(1);
    expect(gateway.start).not.toHaveBeenCalled();
  });

  it('rejects duplicate manual entries while allowing edits to the existing action', async () => {
    await service.save('w', { ...draft, id: 'saved', category: 'develop' });
    await expect(
      service.save('w', { ...draft, id: 'copy', workingDirectory: 'd:\\项目 with spaces\\web\\' }),
    ).rejects.toThrow('已存在');
    await service.save('w', { ...draft, id: 'saved', name: '开发服务', category: 'develop' });
    expect(state.activeWorkspace()?.commonActions).toMatchObject([
      { id: 'saved', name: '开发服务', category: 'develop' },
    ]);
  });

  it('reports the number actually added when suggestions are edited into duplicates', async () => {
    const requestId = service.beginRecognition('w');
    const review = service.propose(
      'w',
      requestId,
      JSON.stringify([draft, { ...draft, command: 'npm test' }]),
    );
    service.editSuggestion('w', review.suggestions[1].id, { command: draft.command });
    expect(await service.confirm('w')).toBe(1);
    expect(state.activeWorkspace()?.commonActions).toHaveLength(1);
  });

  it('keeps editable suggestions and releases the lock when persistence fails', async () => {
    const requestId = service.beginRecognition('w');
    service.propose('w', requestId, JSON.stringify([{ ...draft, category: 'test' }]));
    repository.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(service.confirm('w')).rejects.toThrow('disk full');
    expect(service.reviews()['w'].suggestions).toHaveLength(1);
    expect(service.busy().size).toBe(0);
    expect(state.activeWorkspace()?.commonActions).toBeUndefined();
    expect(await service.confirm('w')).toBe(1);
    expect(state.activeWorkspace()?.commonActions?.[0].category).toBe('test');
  });

  it('marks background starts running without waiting for a mounted console and preserves fast exits', async () => {
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    await service.save('w', { ...draft, id: 'dev' });
    const id = await service.run('w', 'dev');
    expect(state.activeWorkspace()?.terminals.find((item) => item.id === id)?.status).toBe(
      'RUNNING',
    );
    gateway.start.mockImplementationOnce(async (terminal) => {
      state.markTerminalExited(terminal.id, 'COMPLETED');
      return { attached: false, runtimeRevision: 0, cols: 120, rows: 30 };
    });
    const completed = await service.run('w', 'dev', true);
    expect(state.activeWorkspace()?.terminals.find((item) => item.id === completed)?.status).toBe(
      'COMPLETED',
    );
    repository.list.mockResolvedValue(state.workspaces());
    await state.initialize();
    expect(state.activeWorkspace()?.terminals[0].status).toBe('COMPLETED');
  });
});
