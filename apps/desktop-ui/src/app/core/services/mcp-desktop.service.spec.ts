import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelProfile, NetworkProfile } from '../models/agent.models';
import type { Workspace } from '../models/workspace.models';
import { AgentService } from './agent.service';
import { AppStateService } from './app-state.service';
import {
  MCP_DESKTOP_BRIDGE,
  McpDesktopService,
  terminalPlainText,
  type McpDesktopActions,
} from './mcp-desktop.service';
import { TerminalGatewayService } from './terminal-gateway.service';
import { TodoService } from './todo.service';
import { WorkspaceRepository } from './workspace.repository';

const bridge = {
  invoke: vi.fn(),
  handler: undefined as ((event: { payload: unknown }) => void) | undefined,
};

describe('McpDesktopService', () => {
  let service: McpDesktopService;
  let state: AppStateService;
  let todos: TodoService;
  let actions: McpDesktopActions;
  let profile: ModelProfile;
  let network: NetworkProfile;
  const repository = {
    list: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    saveAll: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    watchChanges: vi.fn().mockResolvedValue(() => undefined),
  };
  const gateway = {
    liveTerminals: vi.fn().mockResolvedValue(new Map()),
    start: vi.fn().mockResolvedValue({ attached: false, cols: 120, rows: 30 }),
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const workspace = (id: string): Workspace => ({
    id,
    name: id,
    projectPath: 'D:/project',
    projectType: 'Local project',
    activeBranch: 'main',
    favorite: false,
    lastOpenedAt: 1,
    layout: 'single',
    terminals: [],
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    repository.list.mockResolvedValue([workspace('w1'), workspace('w2')]);
    bridge.invoke.mockResolvedValue(undefined);
    profile = {
      id: 'model',
      name: 'Model',
      provider: 'OpenAI',
      isDefault: true,
      hasCredential: true,
      credentialTarget: 'secret-location',
      claudeEnabled: false,
      claudeModel: '',
      codexEnabled: true,
      codexModel: 'example-model',
    };
    network = {
      id: 'network',
      name: 'Proxy',
      scope: 'global',
      enabled: true,
      isDefault: true,
      proxyUsername: 'user',
      credentialTarget: 'network-secret',
      hasCredential: true,
      npmStrictSsl: true,
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MCP_DESKTOP_BRIDGE,
          useValue: {
            invoke: bridge.invoke,
            mode: () => 'desktop',
            listen: async (_name: string, handler: typeof bridge.handler) => {
              bridge.handler = handler;
              return () => undefined;
            },
          },
        },
        { provide: WorkspaceRepository, useValue: repository },
        { provide: TerminalGatewayService, useValue: gateway },
        {
          provide: AgentService,
          useValue: {
            modelProfiles: () => [profile],
            networkProfiles: () => [network],
            saveNetworkProfile: vi.fn(async (input) => Object.assign(network, input)),
            saveModelProfile: vi.fn(async (input) => Object.assign(profile, input)),
          },
        },
      ],
    });
    state = TestBed.inject(AppStateService);
    await state.initialize();
    todos = TestBed.inject(TodoService);
    await todos.initialize(state.workspaces());
    service = TestBed.inject(McpDesktopService);
    actions = {
      terminalCreated: vi.fn(),
      terminalClosed: vi.fn((id) => state.removeTerminal(id)),
      selectTaskWorkspace: vi.fn((id) => state.selectWorkspace(id)),
      taskLaunchBusy: () => false,
      executeTask: vi.fn(async (id) => {
        todos.beginExecution(id, { terminalId: 'agent' });
      }),
      stopTask: vi.fn(async (id) => {
        todos.stopExecution(id);
      }),
      resumeTask: vi.fn(),
      getPreferences: () => ({
        language: 'en',
        terminalFontSize: 13,
        terminalFontName: 'Consolas',
        inspectorOpen: true,
        workspaceSidebarOpen: true,
      }),
      updatePreferences: vi.fn(),
    };
    await service.start(actions);
  });

  async function createTask() {
    return (await service.execute('task_create', {
      workspaceId: 'w2',
      projectId: todos.projectsFor('w2')[0].id,
      title: 'Build',
      agentType: 'codex',
    })) as { id: string };
  }

  it('uses the configured default model and persists new tasks', async () => {
    const created = await createTask();
    expect(todos.task(created.id)).toMatchObject({
      workspaceId: 'w2',
      profileId: 'model',
      modelName: 'example-model',
      stage: 'todo',
    });
    expect(JSON.parse(localStorage.getItem('termexo.todos.v1')!)['w2'].tasks[0].id).toBe(
      created.id,
    );
  });

  it('rejects an unknown project and unsupported agent profile', async () => {
    await expect(
      service.execute('task_create', {
        workspaceId: 'w2',
        projectId: 'missing',
        title: 'Build',
        agentType: 'codex',
      }),
    ).rejects.toThrow('project ID');
    await expect(
      service.execute('task_create', {
        workspaceId: 'w2',
        projectId: todos.projectsFor('w2')[0].id,
        title: 'Build',
        agentType: 'claude',
      }),
    ).rejects.toThrow('model profile');
    expect(todos.tasksFor('w2')).toHaveLength(0);
  });

  it('runs tasks through the desktop workflow and returns starting state', async () => {
    const task = await createTask();
    const result = await service.execute('task_execute', { taskId: task.id });
    expect(actions.executeTask).toHaveBeenCalledWith(task.id);
    expect(result).toMatchObject({
      stage: 'executing',
      executionState: 'starting',
      terminalId: 'agent',
    });
  });

  it('returns launch failures as errors instead of successful task starts', async () => {
    const task = await createTask();
    actions.executeTask = vi.fn(async (id) => todos.setExecutionError(id, 'Missing CLI'));
    await expect(service.execute('task_execute', { taskId: task.id })).rejects.toThrow(
      'Missing CLI',
    );
  });

  it('detects a busy desktop that did not start the task', async () => {
    const task = await createTask();
    actions.executeTask = vi.fn().mockResolvedValue(undefined);
    await expect(service.execute('task_execute', { taskId: task.id })).rejects.toThrow(
      'did not start',
    );
  });

  it('requires an executing task to stop before editing or deletion', async () => {
    const task = await createTask();
    await service.execute('task_execute', { taskId: task.id });
    await expect(service.execute('task_delete', { taskId: task.id })).rejects.toThrow('Stop');
    await expect(
      service.execute('task_update', { taskId: task.id, title: 'Other' }),
    ).rejects.toThrow('Stop');
    await service.execute('task_stop', { taskId: task.id });
    await service.execute('task_update', { taskId: task.id, title: 'Changed' });
    expect(todos.task(task.id)?.title).toBe('Changed');
    await service.execute('task_delete', { taskId: task.id });
    expect(todos.task(task.id)).toBeNull();
  });

  it('preserves stopped runs on invalid edits and resets them after an agent change', async () => {
    const task = await createTask();
    await service.execute('task_execute', { taskId: task.id });
    await service.execute('task_stop', { taskId: task.id });
    const stopped = todos.task(task.id);
    await expect(
      service.execute('task_update', { taskId: task.id, agentType: 'claude' }),
    ).rejects.toThrow('model profile');
    await expect(
      service.execute('task_update', {
        taskId: task.id,
        agentType: 'opencode',
        projectId: 'missing',
      }),
    ).rejects.toThrow('project ID');
    expect(todos.task(task.id)).toEqual(stopped);
    const updated = await service.execute('task_update', {
      taskId: task.id,
      agentType: 'opencode',
    });
    expect(updated).toMatchObject({ stage: 'todo', executionState: 'idle', agentType: 'opencode' });
    expect(todos.task(task.id)?.terminalId).toBeUndefined();
  });

  it('enforces task completion and verification transitions', async () => {
    const task = await createTask();
    await expect(service.execute('task_verify', { taskId: task.id })).rejects.toThrow('completed');
    await service.execute('task_execute', { taskId: task.id });
    await expect(service.execute('task_complete', { taskId: task.id })).rejects.toThrow(
      'instructions',
    );
    todos.markPromptDelivered(task.id, 'agent');
    await service.execute('task_complete', { taskId: task.id });
    await service.execute('task_verify', { taskId: task.id, note: 'Build passes' });
    expect(todos.task(task.id)).toMatchObject({
      stage: 'verified',
      validations: [expect.objectContaining({ note: 'Build passes', outcome: 'passed' })],
    });
  });

  it('creates a running terminal in a background workspace and reveals it', async () => {
    const terminal = (await service.execute('terminal_create', {
      workspaceId: 'w2',
      name: 'AI shell',
    })) as { id: string };
    expect(gateway.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: terminal.id, agentType: 'shell' }),
      120,
      30,
      'w2',
    );
    expect(actions.terminalCreated).toHaveBeenCalledWith('w2', terminal.id);
    await service.execute('terminal_write', {
      terminalId: terminal.id,
      data: 'echo hello',
      submit: true,
    });
    expect(gateway.write).toHaveBeenCalledWith(
      expect.objectContaining({ id: terminal.id }),
      'echo hello\r',
    );
    await service.execute('terminal_close', { terminalId: terminal.id });
    expect(state.workspaces().find((w) => w.id === 'w2')?.terminals).toHaveLength(0);
    expect(state.activeWorkspace()?.id).toBe('w1');
    expect(repository.flush).toHaveBeenCalled();
  });

  it('removes the terminal tab when its process cannot start', async () => {
    gateway.start.mockRejectedValueOnce(new Error('Directory missing'));
    await expect(service.execute('terminal_create', { workspaceId: 'w2' })).rejects.toThrow(
      'Directory missing',
    );
    expect(state.workspaces().find((w) => w.id === 'w2')?.terminals).toHaveLength(0);
    expect(actions.terminalCreated).not.toHaveBeenCalled();
  });

  it('bounds terminal snapshots and removes terminal escapes', async () => {
    const terminal = state.createTerminal({ agentType: 'shell' }, 'w1')!;
    bridge.invoke.mockResolvedValueOnce({
      data: '\x1b[31m你好 world\x1b[0m',
      sequence: 2,
      runtimeRevision: 0,
    });
    expect(
      await service.execute('terminal_read', { terminalId: terminal.id, maxChars: 5 }),
    ).toMatchObject({ data: 'world', truncated: true, sequence: 2 });
  });

  it('excludes credential locations from settings and preserves stored keys on model updates', async () => {
    const settings = await service.execute('settings_get', {});
    expect(JSON.stringify(settings)).not.toContain('secret');
    await service.execute('model_profile_update', { profileId: 'model', codexModel: 'updated' });
    const agents = TestBed.inject(AgentService);
    expect(agents.saveModelProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'model', codexModel: 'updated', clearCredential: false }),
    );
    expect(vi.mocked(agents.saveModelProfile).mock.calls[0][0].apiKey).toBeUndefined();
    expect(profile.credentialTarget).toBe('secret-location');
  });

  it('does not execute expired desktop requests and reports their failure', async () => {
    bridge.handler!({
      payload: {
        id: 'expired',
        name: 'settings_update',
        arguments: { inspectorOpen: false },
        deadline: Date.now() - 1,
      },
    });
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith(
        'complete_mcp_tool',
        expect.objectContaining({ id: 'expired', error: expect.stringContaining('expired') }),
      ),
    );
    expect(actions.updatePreferences).not.toHaveBeenCalled();
  });

  it('preserves proxy credentials when editing a network profile', async () => {
    await service.execute('network_profile_update', {
      profileId: 'network',
      httpProxy: 'http://127.0.0.1:8080',
    });
    const agents = TestBed.inject(AgentService);
    expect(agents.saveNetworkProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'network',
        proxyUsername: 'user',
        clearCredential: false,
        httpProxy: 'http://127.0.0.1:8080',
      }),
    );
    expect(vi.mocked(agents.saveNetworkProfile).mock.calls[0][0].proxyPassword).toBeUndefined();
    expect(network.credentialTarget).toBe('network-secret');
  });

  it('refuses a second desktop action while a timed-out action is still running', async () => {
    const task = await createTask();
    let finish!: () => void;
    actions.executeTask = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    bridge.handler!({
      payload: {
        id: 'long',
        name: 'task_execute',
        arguments: { taskId: task.id },
        deadline: Date.now() + 60000,
      },
    });
    await vi.waitFor(() => expect(actions.executeTask).toHaveBeenCalledOnce());
    bridge.handler!({
      payload: {
        id: 'next',
        name: 'settings_update',
        arguments: { inspectorOpen: false },
        deadline: Date.now() + 60000,
      },
    });
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith(
        'complete_mcp_tool',
        expect.objectContaining({ id: 'next', error: expect.stringContaining('still running') }),
      ),
    );
    expect(actions.updatePreferences).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith(
        'complete_mcp_tool',
        expect.objectContaining({ id: 'long' }),
      ),
    );
  });
});

describe('terminalPlainText', () => {
  it('preserves Unicode, lines and tabs while removing colour, links and cursor controls', () => {
    expect(
      terminalPlainText(
        '\x1b]8;;https://example.com\x07\x1b[32m中文\x1b[0m\x1b]8;;\x07\r\n\tline\x1b[?25h',
      ),
    ).toBe('中文\n\tline');
  });
});
