import { type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AgentService } from './core/services/agent.service';
import { AppStateService } from './core/services/app-state.service';
import { WorkspaceRepository } from './core/services/workspace.repository';
import type { OneRingCoordinatorRequest } from './core/models/one-ring.models';
import type { CodexLaunchDialogValue } from './dialogs/codex-launch-dialog';

interface Flow {
  createWorkspace(value: { name: string; projectPath: string }): Promise<void>;
  openOneRingCoordinator(request: OneRingCoordinatorRequest): Promise<void>;
  launchCodex(value: CodexLaunchDialogValue): Promise<void>;
  closeCodexLaunch(): void;
  pendingOneRing: WritableSignal<OneRingCoordinatorRequest | null>;
  selectedTerminalDirectory: WritableSignal<string | null>;
}

describe('One Ring coordinator launch', () => {
  let flow: Flow;
  let agents: AgentService;
  let state: AppStateService;
  const request = { root: 'D:\\project', goal: 'Fix retry and verify zero' };
  beforeEach(async () => {
    vi.spyOn(
      App.prototype as unknown as { initialize(): Promise<void> },
      'initialize',
    ).mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: WorkspaceRepository, useValue: { save: vi.fn().mockResolvedValue(undefined) } },
      ],
    });
    const fixture = TestBed.createComponent(App);
    flow = fixture.componentInstance as unknown as Flow;
    agents = TestBed.inject(AgentService);
    state = TestBed.inject(AppStateService);
    vi.spyOn(agents, 'codexInstallation').mockReturnValue({
      agentType: 'codex',
      installed: true,
      healthy: true,
      executablePath: 'codex',
      version: '0.163.0',
      diagnostic: '',
    });
    vi.spyOn(agents, 'prepareCodexLaunch').mockResolvedValue({
      command: "& 'codex'",
      executablePath: 'codex',
    });
    await flow.createWorkspace({ name: 'Project', projectPath: request.root });
  });
  afterEach(() => vi.restoreAllMocks());
  it('keeps the One Ring project and disables auto confirmation through the existing Codex launch', async () => {
    await flow.openOneRingCoordinator(request);
    flow.selectedTerminalDirectory.set('D:\\unrelated-directory');
    await flow.launchCodex({ name: 'Retry', model: 'chosen-model', autoConfirm: true });
    expect(agents.prepareCodexLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ oneRing: request, model: 'chosen-model', autoConfirm: false }),
    );
    expect(state.activeWorkspace()?.terminals[0]).toMatchObject({
      name: 'One Ring · Retry',
      workingDirectory: request.root,
      autoConfirm: false,
    });
  });
  it('refuses to launch a pending task into a different active workspace', async () => {
    await flow.openOneRingCoordinator(request);
    await flow.createWorkspace({ name: 'Other', projectPath: 'D:\\other' });
    await flow.launchCodex({ name: '' });
    expect(agents.prepareCodexLaunch).not.toHaveBeenCalled();
  });
  it('clears cancelled One Ring intent before an ordinary Codex launch', async () => {
    await flow.openOneRingCoordinator(request);
    flow.closeCodexLaunch();
    expect(flow.pendingOneRing()).toBeNull();
    flow.selectedTerminalDirectory.set(request.root);
    await flow.launchCodex({ name: 'Ordinary', autoConfirm: true });
    expect(agents.prepareCodexLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ oneRing: undefined, autoConfirm: true }),
    );
  });
});
