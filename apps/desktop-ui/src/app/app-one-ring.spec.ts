import { type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AgentService } from './core/services/agent.service';
import { AppStateService } from './core/services/app-state.service';
import { WorkspaceRepository } from './core/services/workspace.repository';
import type { OneRingCoordinatorRequest } from './core/models/one-ring.models';
import type { CodexLaunchDialogValue } from './dialogs/codex-launch-dialog';
import type { ModelProfile } from './core/models/agent.models';
import { OneRingService } from './core/services/one-ring.service';
import { CLI_NATIVE_PROFILE_ID } from './core/models/launch-model-choice';

interface Flow {
  createWorkspace(value: { name: string; projectPath: string }): Promise<void>;
  openOneRingCoordinator(request: OneRingCoordinatorRequest): Promise<void>;
  launchCodex(value: CodexLaunchDialogValue): Promise<void>;
  closeCodexLaunch(): void;
  pendingOneRing: WritableSignal<OneRingCoordinatorRequest | null>;
  selectedTerminalDirectory: WritableSignal<string | null>;
  codexLaunchOpen: WritableSignal<boolean>;
  refreshRestoredClaudeLaunches(): Promise<void>;
  refreshRestoredCodexLaunches(): Promise<void>;
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
        { provide: OneRingService, useValue: { findCoordinator: vi.fn().mockResolvedValue(null) } },
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
  it('preserves the user implementation profile and shows the explicitly selected coordinator model', async () => {
    const chosen: OneRingCoordinatorRequest = { ...request, implementer: { cli: 'opencode', model: 'provider/approved-model' } };
    vi.spyOn(agents, 'modelProfiles').mockReturnValue([{ id: 'profile', provider: 'OpenAI', codexEnabled: true, codexModel: 'profile-default' } as ModelProfile]);
    await flow.openOneRingCoordinator(chosen);
    await flow.launchCodex({ name: 'Selected', profileId: 'profile', model: 'selected-current-model' });
    expect(agents.prepareCodexLaunch).toHaveBeenCalledWith(expect.objectContaining({ oneRing: chosen, model: 'selected-current-model' }));
    expect(state.activeWorkspace()?.terminals[0]?.model).toBe('selected-current-model');
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
  it('returns to an existing coordinator without opening another launch dialog, including repeated concurrent clicks', async () => {
    const original = state.createTerminal({ id: 'original', agentType: 'codex', name: 'Original coordinator' })!;
    state.createTerminal({ agentType: 'opencode', name: 'Implementation' });
    vi.mocked(TestBed.inject(OneRingService).findCoordinator).mockResolvedValue(original.id);
    const existing = { ...request, workflowId: 'workflow', coordinatorTerminalId: original.id };
    await Promise.all([flow.openOneRingCoordinator(existing), flow.openOneRingCoordinator(existing)]);
    expect(state.activeTerminal()?.id).toBe(original.id);
    expect(state.activeWorkspace()?.terminals).toHaveLength(2);
    expect(flow.codexLaunchOpen()).toBe(false);
    expect(flow.pendingOneRing()).toBeNull();
    expect(TestBed.inject(OneRingService).findCoordinator).toHaveBeenCalledTimes(1);
    expect(agents.prepareCodexLaunch).not.toHaveBeenCalled();
  });
  it('offers a replacement only when the workflow has no remaining coordinator', async () => {
    await flow.openOneRingCoordinator({ ...request, workflowId: 'closed-workflow' });
    expect(flow.codexLaunchOpen()).toBe(true);
    expect(flow.pendingOneRing()?.workflowId).toBe('closed-workflow');
  });
  it('restores official model selections without substituting a custom default profile', async () => {
    vi.spyOn(agents, 'modelProfiles').mockReturnValue([{ id: 'third-party', isDefault: true, provider: 'Custom', hasCredential: true,
      claudeEnabled: true, claudeModel: 'custom-claude', codexEnabled: true, codexModel: 'custom-codex' } as ModelProfile]);
    vi.spyOn(agents, 'prepareLaunch').mockResolvedValue({ command: 'claude --model claude-current', executablePath: 'claude' });
    state.createTerminal({ id: 'native-claude', agentType: 'claude', model: 'claude-current', profileId: CLI_NATIVE_PROFILE_ID });
    state.createTerminal({ id: 'native-codex', agentType: 'codex', model: 'gpt-current', profileId: CLI_NATIVE_PROFILE_ID });
    await flow.refreshRestoredClaudeLaunches();
    await flow.refreshRestoredCodexLaunches();
    expect(agents.prepareLaunch).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 'native-claude', model: 'claude-current', profileId: CLI_NATIVE_PROFILE_ID }));
    expect(agents.prepareCodexLaunch).toHaveBeenCalledWith(expect.objectContaining({ terminalId: 'native-codex', model: 'gpt-current', profileId: CLI_NATIVE_PROFILE_ID }));
    expect(state.activeWorkspace()?.terminals.find(t => t.id === 'native-claude')?.model).toBe('claude-current');
    expect(state.activeWorkspace()?.terminals.find(t => t.id === 'native-codex')?.profileId).toBe(CLI_NATIVE_PROFILE_ID);
  });
});
