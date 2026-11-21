import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import type { AgentEvent, AgentSession, AntigravityLaunchRequest } from './core/models/agent.models';
import { ANTIGRAVITY_DEFAULT_MODEL } from './core/models/workspace.models';
import { AgentService } from './core/services/agent.service';
import { AppStateService } from './core/services/app-state.service';
import { WorkspaceRepository } from './core/services/workspace.repository';
import type { ResumeSessionValue } from './dialogs/session-center-dialog';

describe('Antigravity session restore and resume', () => {
  let app: {
    refreshRestoredNativeModelLaunches(agentType: 'grok' | 'pi' | 'antigravity'): Promise<void>;
    resumeAgent(value: ResumeSessionValue): Promise<void>;
  };
  let state: AppStateService;
  let prepareAntigravityLaunch: ReturnType<typeof vi.fn>;
  let sessions: ReturnType<typeof signal<AgentSession[]>>;
  let events: ReturnType<typeof signal<AgentEvent[]>>;

  beforeEach(async () => {
    vi.spyOn(
      App.prototype as unknown as { initialize(): Promise<void> },
      'initialize',
    ).mockResolvedValue(undefined);
    sessions = signal<AgentSession[]>([]);
    events = signal<AgentEvent[]>([]);
    prepareAntigravityLaunch = vi.fn(async (request: AntigravityLaunchRequest) => ({
      command: request.sessionId
        ? `agy --conversation '${request.sessionId}'`
        : request.continueLast
          ? 'agy --continue'
          : 'agy',
      executablePath: 'agy',
    }));

    TestBed.configureTestingModule({
      providers: [
        { provide: WorkspaceRepository, useValue: { save: vi.fn().mockResolvedValue(undefined) } },
        {
          provide: AgentService,
          useValue: {
            sessions: sessions.asReadonly(),
            events: events.asReadonly(),
            modelProfiles: signal([]).asReadonly(),
            accountProfiles: signal([]).asReadonly(),
            prepareAntigravityLaunch,
          },
        },
      ],
    });
    TestBed.overrideComponent(App, { set: { template: '' } });
    await TestBed.compileComponents();
    app = TestBed.createComponent(App).componentInstance as unknown as typeof app;
    state = TestBed.inject(AppStateService);
    await state.createWorkspace('Termexo', 'D:\\devlop\\Termexo');
  });

  afterEach(() => vi.restoreAllMocks());

  it('automatically resumes a restored Antigravity terminal by its saved conversation id', async () => {
    const workspace = state.activeWorkspace()!;
    const terminal = state.createTerminal({
      agentType: 'antigravity',
      name: 'AGY',
      command: 'agy',
      model: ANTIGRAVITY_DEFAULT_MODEL,
      nativeSessionId: 'conv-saved-1',
      workingDirectory: 'D:\\devlop\\Termexo',
      autoConfirm: true,
    })!;

    await app.refreshRestoredNativeModelLaunches('antigravity');

    expect(prepareAntigravityLaunch).toHaveBeenCalledExactlyOnceWith({
      terminalId: terminal.id,
      workspaceId: workspace.id,
      workingDirectory: 'D:\\devlop\\Termexo',
      sessionId: 'conv-saved-1',
      continueLast: false,
      model: undefined,
      autoConfirm: true,
    });
    const updated = state.activeWorkspace()!.terminals.find((item) => item.id === terminal.id)!;
    expect(updated.command).toBe("agy --conversation 'conv-saved-1'");
    expect(updated.nativeSessionId).toBe('conv-saved-1');
  });

  it('recovers the latest Antigravity conversation id from synced events and preserves explicit model', async () => {
    const terminal = state.createTerminal({
      agentType: 'antigravity',
      name: 'AGY Explicit',
      command: 'agy',
      model: 'gemini-3.8-flash-high',
      workingDirectory: 'D:\\devlop\\Termexo',
    })!;
    events.set([
      {
        eventKey: 'evt-1',
        agentType: 'antigravity',
        nativeSessionId: 'conv-from-event',
        terminalId: terminal.id,
        eventType: 'task.completed',
        detail: {},
        createdAt: Date.now(),
      },
    ]);

    await app.refreshRestoredNativeModelLaunches('antigravity');

    expect(prepareAntigravityLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalId: terminal.id,
        sessionId: 'conv-from-event',
        continueLast: false,
        model: 'gemini-3.8-flash-high',
      }),
    );
    const updated = state.activeWorkspace()!.terminals.find((item) => item.id === terminal.id)!;
    expect(updated.nativeSessionId).toBe('conv-from-event');
  });

  it('falls back to --continue when a restored Antigravity terminal has no recorded conversation id', async () => {
    const terminal = state.createTerminal({
      agentType: 'antigravity',
      name: 'AGY No Id',
      command: 'agy',
      model: ANTIGRAVITY_DEFAULT_MODEL,
      workingDirectory: 'D:\\devlop\\Termexo',
    })!;

    await app.refreshRestoredNativeModelLaunches('antigravity');

    expect(prepareAntigravityLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalId: terminal.id,
        sessionId: undefined,
        continueLast: true,
        model: undefined,
      }),
    );
    const updated = state.activeWorkspace()!.terminals.find((item) => item.id === terminal.id)!;
    expect(updated.command).toBe('agy --continue');
  });

  it('skips adopted Antigravity terminals that are still running', async () => {
    const terminal = state.createTerminal({
      agentType: 'antigravity',
      name: 'AGY Live',
      command: 'agy',
      model: ANTIGRAVITY_DEFAULT_MODEL,
      nativeSessionId: 'conv-live',
    })!;
    vi.spyOn(state, 'isAdoptedTerminal').mockImplementation((id) => id === terminal.id);

    await app.refreshRestoredNativeModelLaunches('antigravity');

    expect(prepareAntigravityLaunch).not.toHaveBeenCalled();
  });

  it('resumes a historical Antigravity session via prepareAntigravityLaunch', async () => {
    await app.resumeAgent({
      session: {
        id: 'conv-history',
        agentType: 'antigravity',
        nativeSessionId: 'conv-history',
        projectPath: 'D:\\devlop\\Termexo',
        title: 'Resume AGY',
        status: 'HISTORICAL',
        messageCount: 3,
        transcriptPath: 'transcript.jsonl',
        createdAt: 1_700_000_000_000,
        lastUsedAt: 1_700_000_100_000,
      },
      autoConfirm: true,
    });

    expect(prepareAntigravityLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: 'D:\\devlop\\Termexo',
        sessionId: 'conv-history',
        autoConfirm: true,
      }),
    );
    const created = state.activeWorkspace()!.terminals.at(-1)!;
    expect(created.agentType).toBe('antigravity');
    expect(created.nativeSessionId).toBe('conv-history');
    expect(created.model).toBe(ANTIGRAVITY_DEFAULT_MODEL);
    expect(created.command).toBe("agy --conversation 'conv-history'");
  });
});
