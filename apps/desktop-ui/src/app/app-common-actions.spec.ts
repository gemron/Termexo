import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { AppStateService } from './core/services/app-state.service';
import { CommonActionsService } from './core/services/common-actions.service';
import { AgentStartupService, type AgentStartupRequest } from './core/services/agent-startup.service';
import { WorkspaceRepository } from './core/services/workspace.repository';

interface RecognitionFlow {
  commonActionsOpen: WritableSignal<boolean>;
  codexLaunchOpen: WritableSignal<boolean>;
  openCodexLaunch(): Promise<void>;
  closeCodexLaunch(): void;
  startCommonActionAgent(): Promise<void>;
  armStartupDialogs(terminalId: string): void;
  deliverTerminalPrompt(terminalId: string, content: string, submit: boolean): Promise<void>;
  viewCommonActionAgent(terminalId: string): void;
}

describe('continuous common action recognition', () => {
  let flow: RecognitionFlow;
  let state: AppStateService;
  let actions: CommonActionsService;
  const startup = { arm: vi.fn(), markRuntimeStarted: vi.fn(), awaitingTerminalIds: signal<readonly string[]>([]) };
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
});
