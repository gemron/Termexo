import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { AppStateService } from './core/services/app-state.service';
import { CommonActionsService } from './core/services/common-actions.service';
import { AgentStartupService, type AgentStartupRequest } from './core/services/agent-startup.service';
import { WorkspaceRepository } from './core/services/workspace.repository';
import type { TerminalExitEvent } from './core/services/terminal-gateway.service';
import type { CommonActionTerminalRequest } from './core/models/common-action';
import { RemoteConnectionService } from './core/services/remote-connection.service';

interface RecognitionFlow {
  commonActionsOpen: WritableSignal<boolean>;
  codexLaunchOpen: WritableSignal<boolean>;
  openCodexLaunch(): Promise<void>;
  closeCodexLaunch(): void;
  startCommonActionAgent(): Promise<void>;
  armStartupDialogs(terminalId: string): void;
  deliverTerminalPrompt(terminalId: string, content: string, submit: boolean): Promise<void>;
  viewCommonActionAgent(terminalId: string): void;
  handleTerminalExit(event: TerminalExitEvent): void;
  controlCommonAction(request: CommonActionTerminalRequest): Promise<void>;
  openCommonActionTerminal(terminalId: string): void;
  showToast(message: string, tone?: string): void;
}

describe('continuous common action recognition', () => {
  let flow: RecognitionFlow;
  let state: AppStateService;
  let actions: CommonActionsService;
  const startup = { arm: vi.fn(), cancel: vi.fn(), markRuntimeStarted: vi.fn(), awaitingTerminalIds: signal<readonly string[]>([]) };
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(App.prototype as unknown as { initialize(): Promise<void> }, 'initialize').mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [
      { provide: WorkspaceRepository, useValue: { save: vi.fn().mockResolvedValue(undefined) } },
      { provide: AgentStartupService, useValue: startup },
    ] });
    TestBed.overrideComponent(App, { set: { template: '' } });
    await TestBed.compileComponents();
    flow = TestBed.createComponent(App).componentInstance as unknown as RecognitionFlow;
    state = TestBed.inject(AppStateService);
    actions = TestBed.inject(CommonActionsService);
    await state.createWorkspace('Project', 'D:/project');
    TestBed.tick();
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    vi.spyOn(flow, 'openCodexLaunch').mockImplementation(async () => flow.codexLaunchOpen.set(true));
    vi.spyOn(flow, 'deliverTerminalPrompt').mockResolvedValue(undefined);
    flow.commonActionsOpen.set(true);
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    vi.restoreAllMocks();
  });

  async function launch() {
    await flow.startCommonActionAgent();
    const terminal = state.createTerminal({ agentType: 'codex' })!;
    flow.armStartupDialogs(terminal.id);
    return { terminal, request: startup.arm.mock.calls.at(-1)![1] as AgentStartupRequest };
  }

  async function actionConsole() {
    const terminal = state.createTerminal({ agentType: 'shell', commonActionId: 'dev' })!;
    const workspace = state.activeWorkspace()!;
    await state.saveCommonActions(workspace.id, [{
      id: 'dev', name: 'Dev server', command: 'npm run dev', description: '',
      workingDirectory: 'D:/project/web', environment: { PORT: '4300' }, terminalId: terminal.id,
    }]);
    return { workspace, terminal };
  }

  it.each(['run', 'restart'] as const)('routes %s through the saved action and reveals the replacement console', async (operation) => {
    const { workspace, terminal } = await actionConsole();
    const run = vi.spyOn(actions, 'run').mockImplementation(async () => {
      state.removeTerminal(terminal.id);
      return state.createTerminal({ agentType: 'shell', commonActionId: 'dev' })!.id;
    });
    const reveal = vi.spyOn(flow, 'openCommonActionTerminal');
    await flow.controlCommonAction({ terminalId: terminal.id, operation });
    expect(run).toHaveBeenCalledExactlyOnceWith(workspace.id, 'dev', operation === 'restart');
    expect(reveal).toHaveBeenCalledExactlyOnceWith(state.activeTerminal()!.id);
    expect(state.activeTerminal()!.id).not.toBe(terminal.id);
  });

  it('stops through the shared action service without closing the output window', async () => {
    const { workspace, terminal } = await actionConsole();
    const stop = vi.spyOn(actions, 'stop').mockResolvedValue(undefined);
    await flow.controlCommonAction({ terminalId: terminal.id, operation: 'stop' });
    expect(stop).toHaveBeenCalledExactlyOnceWith(workspace.id, 'dev');
    expect(state.activeWorkspace()!.terminals.some((item) => item.id === terminal.id)).toBe(true);
  });

  it('does not let an obsolete console stop the action currently bound to another terminal', async () => {
    const { workspace, terminal } = await actionConsole();
    const replacement = state.createTerminal({ agentType: 'shell', commonActionId: 'dev' })!;
    await state.saveCommonActions(workspace.id, [{
      ...state.activeWorkspace()!.commonActions![0], terminalId: replacement.id,
    }]);
    const stop = vi.spyOn(actions, 'stop').mockResolvedValue(undefined);
    await flow.controlCommonAction({ terminalId: terminal.id, operation: 'stop' });
    expect(stop).not.toHaveBeenCalled();
  });

  it('ignores action requests in read-only mode or while another operation is pending', async () => {
    const { workspace, terminal } = await actionConsole();
    const stop = vi.spyOn(actions, 'stop').mockResolvedValue(undefined);
    const readOnly = vi.spyOn(TestBed.inject(RemoteConnectionService), 'readOnly').mockReturnValue(true);
    await flow.controlCommonAction({ terminalId: terminal.id, operation: 'stop' });
    readOnly.mockReturnValue(false);
    actions.busy.set(new Set([workspace.id]));
    await flow.controlCommonAction({ terminalId: terminal.id, operation: 'stop' });
    expect(stop).not.toHaveBeenCalled();
  });

  it('reports launch errors without leaving an unhandled button rejection', async () => {
    const { terminal } = await actionConsole();
    vi.spyOn(actions, 'run').mockRejectedValue(new Error('Port is unavailable'));
    const toast = vi.spyOn(flow, 'showToast');
    await flow.controlCommonAction({ terminalId: terminal.id, operation: 'restart' });
    expect(toast).toHaveBeenCalledWith('Port is unavailable', 'error');
  });

  it('returns from launching and sends recognition only after the Agent is ready', async () => {
    const { terminal, request } = await launch();
    expect(flow.commonActionsOpen()).toBe(true);
    const review = actions.reviews()[state.activeWorkspace()!.id];
    expect(review).toMatchObject({ waiting: true, terminalId: terminal.id, phase: 'starting' });
    expect(flow.deliverTerminalPrompt).not.toHaveBeenCalled();
    await request.submit();
    expect(flow.deliverTerminalPrompt).toHaveBeenCalledExactlyOnceWith(terminal.id, expect.stringContaining(review.requestId), true);
    expect(actions.reviews()[state.activeWorkspace()!.id].phase).toBe('reading');
  });

  it('does not send the queued prompt if the user cancels while the Agent starts', async () => {
    const { request } = await launch();
    actions.discard(state.activeWorkspace()!.id);
    await request.submit();
    expect(flow.deliverTerminalPrompt).not.toHaveBeenCalled();
  });

  it('automatically returns from Agent progress to review when suggestions arrive', async () => {
    const { terminal } = await launch();
    const workspaceId = state.activeWorkspace()!.id;
    const review = actions.reviews()[workspaceId];
    flow.viewCommonActionAgent(terminal.id);
    TestBed.tick();
    expect(flow.commonActionsOpen()).toBe(false);
    actions.propose(workspaceId, review.requestId, JSON.stringify([
      { name: '测试', command: 'npm test', workingDirectory: 'D:/project', description: '' },
    ]));
    TestBed.tick();
    expect(flow.commonActionsOpen()).toBe(true);
    expect(state.activeWorkspace()!.commonActions).toBeUndefined();
  });

  it('shows launch failure inline and returns to the original dialog when launch is cancelled', async () => {
    const { request } = await launch();
    request.onFailed('Agent 未就绪');
    expect(actions.reviews()[state.activeWorkspace()!.id]).toMatchObject({ waiting: false, error: 'Agent 未就绪' });
    actions.discard(state.activeWorkspace()!.id);
    await flow.startCommonActionAgent();
    expect(flow.commonActionsOpen()).toBe(false);
    flow.closeCodexLaunch();
    expect(flow.commonActionsOpen()).toBe(true);
    expect(actions.reviews()[state.activeWorkspace()!.id]).toBeUndefined();
  });

  it('records successful common commands as completed while ordinary shell exits stay stopped', () => {
    const command = state.createTerminal({ agentType: 'shell', commonActionId: 'test' })!;
    flow.handleTerminalExit({ terminalId: command.id, runtimeRevision: command.runtimeRevision ?? 0, exitCode: 0, success: true });
    expect(state.activeTerminal()?.status).toBe('COMPLETED');
    const shell = state.createTerminal({ agentType: 'shell' })!;
    flow.handleTerminalExit({ terminalId: shell.id, runtimeRevision: shell.runtimeRevision ?? 0, exitCode: 0, success: true });
    expect(state.activeTerminal()?.status).toBe('STOPPED');
  });
});
