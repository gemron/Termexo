import type { Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import type { AccountProfileInput } from './core/models/agent.models';
import { AgentService } from './core/services/agent.service';
import { AppStateService } from './core/services/app-state.service';
import { WorkspaceRepository } from './core/services/workspace.repository';
import { TerminalExitEvent, TerminalGatewayService } from './core/services/terminal-gateway.service';
import { AccountLoginFeedbackService } from './core/services/account-login-feedback.service';

interface AccountLoginFlow {
  loginAccount(input: AccountProfileInput): Promise<void>;
  retryAccountLogin(terminalId: string): Promise<void>;
  pendingAccountLogins: Map<string, string>;
  handleTerminalExit(event: TerminalExitEvent): void;
  refreshAccountAfterLogin(profileId: string, terminalId: string, success: boolean): Promise<void>;
  profileSaving: Signal<boolean>;
  settingsOpen: WritableSignal<boolean>;
  toastMessage: Signal<string | null>;
}

describe('App account login', () => {
  let flow: AccountLoginFlow;
  let state: AppStateService;
  let agents: AgentService;
  const input: AccountProfileInput = {
    id: 'device-account',
    name: 'Device account',
    agentType: 'codex',
    loginMethod: 'device-code',
    isDefault: false,
  };

  beforeEach(() => {
    vi.spyOn(
      App.prototype as unknown as { initialize(): Promise<void> },
      'initialize',
    ).mockResolvedValue(undefined);
    vi.spyOn(
      App.prototype as unknown as {
        watchAccountLogin(id: string, terminalId: string): Promise<void>;
      },
      'watchAccountLogin',
    ).mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: WorkspaceRepository, useValue: { save: vi.fn().mockResolvedValue(undefined) } },
      ],
    });
    flow = TestBed.createComponent(App).componentInstance as unknown as AccountLoginFlow;
    state = TestBed.inject(AppStateService);
    agents = TestBed.inject(AgentService);
    flow.settingsOpen.set(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it('waits for the selected method to be saved and ignores repeated login clicks', async () => {
    await state.createWorkspace('Project', 'D:\\projects\\current');
    const save = agents.saveAccountProfile.bind(agents);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const saving = vi.spyOn(agents, 'saveAccountProfile').mockImplementation(async (profile) => {
      await gate;
      await save(profile);
    });
    const loggingIn = flow.loginAccount(input);
    expect(flow.profileSaving()).toBe(true);
    expect(state.activeWorkspace()?.terminals).toEqual([]);
    await flow.loginAccount(input);
    expect(saving).toHaveBeenCalledOnce();
    finish();
    await loggingIn;
    expect(state.activeWorkspace()?.terminals).toEqual([
      expect.objectContaining({
        accountLogin: true,
        accountProfileId: input.id,
        command: 'codex login --device-auth',
        workingDirectory: 'D:\\projects\\current',
      }),
    ]);
    expect(agents.accountProfiles()[0].loginMethod).toBe('device-code');
    expect(flow.profileSaving()).toBe(false);
    expect(flow.settingsOpen()).toBe(false);
  });

  it('keeps the settings open without launching if saving the method fails', async () => {
    await state.createWorkspace('Project', 'D:\\projects\\current');
    vi.spyOn(agents, 'saveAccountProfile').mockRejectedValueOnce(new Error('Disk is full'));
    await flow.loginAccount(input);
    expect(state.activeWorkspace()?.terminals).toEqual([]);
    expect(flow.settingsOpen()).toBe(true);
    expect(flow.profileSaving()).toBe(false);
    expect(flow.toastMessage()).toContain('Disk is full');
  });

  it('explains that a workspace is required before creating a login terminal', async () => {
    const saving = vi.spyOn(agents, 'saveAccountProfile');
    await flow.loginAccount(input);
    expect(saving).not.toHaveBeenCalled();
    expect(flow.toastMessage()).toBeTruthy();
    expect(flow.settingsOpen()).toBe(true);
  });

  it('retries only the selected account in a fresh terminal and preserves the other account', async () => {
    await state.createWorkspace('Project', 'D:\\projects\\current');
    await flow.loginAccount(input);
    const original = state.activeWorkspace()!.terminals[0];
    await flow.loginAccount({ ...input, id: 'other-account', name: 'Other account' });
    const other = state.activeWorkspace()!.terminals.find((item) => item.accountProfileId === 'other-account')!;
    const feedback = TestBed.inject(AccountLoginFeedbackService);
    feedback.setPhase(original.id, 'rejected');
    const close = vi.spyOn(TestBed.inject(TerminalGatewayService), 'close').mockResolvedValue(undefined);
    await flow.retryAccountLogin(original.id);
    expect(close).toHaveBeenCalledExactlyOnceWith(original.id);
    const terminals = state.activeWorkspace()!.terminals;
    expect(terminals).toHaveLength(2);
    expect(terminals).toContainEqual(other);
    const next = terminals.find((item) => item.accountProfileId === input.id)!;
    expect(next.id).not.toBe(original.id);
    expect(next.workingDirectory).toBe(original.workingDirectory);
    expect(next.command).toBe('codex login --device-auth');
    expect(feedback.get(original.id)).toBeUndefined();
    expect(feedback.get(next.id)?.phase).toBe('waiting');
    expect(feedback.get(other.id)?.phase).toBe('waiting');
  });

  it('keeps the failure page available when preparing a retry fails', async () => {
    await state.createWorkspace('Project', 'D:\\projects\\current');
    await flow.loginAccount(input);
    const original = state.activeWorkspace()!.terminals[0];
    const close = vi.spyOn(TestBed.inject(TerminalGatewayService), 'close').mockResolvedValue(undefined);
    vi.spyOn(agents, 'prepareAccountLogin').mockRejectedValueOnce(new Error('Cannot prepare login'));
    await flow.retryAccountLogin(original.id);
    expect(close).not.toHaveBeenCalled();
    expect(state.activeWorkspace()!.terminals).toContainEqual(original);
    expect(TestBed.inject(AccountLoginFeedbackService).get(original.id)?.phase).toBe('closed');
    expect(flow.toastMessage()).toContain('Cannot prepare login');
    expect(flow.profileSaving()).toBe(false);
  });

  it('ignores an exit from an older runtime before touching login state', async () => {
    await state.createWorkspace('Project', 'D:\\projects\\current');
    await flow.loginAccount(input);
    const terminal = state.activeWorkspace()!.terminals[0];
    flow.pendingAccountLogins.set(terminal.id, input.id);
    const refresh = vi.spyOn(agents, 'refreshAccountProfile').mockResolvedValue(undefined);
    flow.handleTerminalExit({ terminalId: terminal.id, runtimeRevision: (terminal.runtimeRevision ?? 0) + 1,
      exitCode: 1, success: false });
    expect(refresh).not.toHaveBeenCalled();
    expect(flow.pendingAccountLogins.get(terminal.id)).toBe(input.id);
    expect(TestBed.inject(AccountLoginFeedbackService).get(terminal.id)?.phase).toBe('waiting');
  });

  it('can retry a restored login whose old PTY no longer exists', async () => {
    await state.createWorkspace('Project', 'D:\\projects\\current');
    await flow.loginAccount(input);
    const original = state.activeWorkspace()!.terminals[0];
    vi.spyOn(TestBed.inject(TerminalGatewayService), 'close').mockRejectedValueOnce(`terminal ${original.id} was not found`);
    await flow.retryAccountLogin(original.id);
    const next = state.activeWorkspace()!.terminals[0];
    expect(next.id).not.toBe(original.id);
    expect(next.accountProfileId).toBe(input.id);
    expect(TestBed.inject(AccountLoginFeedbackService).get(next.id)?.phase).toBe('waiting');
  });

  it('does not report a failed login as successful because old credentials still exist', async () => {
    await state.createWorkspace('Project', 'D:\\projects\\current');
    await flow.loginAccount(input);
    const terminal = state.activeWorkspace()!.terminals[0];
    const profiles = agents.accountProfiles().map((profile) => ({ ...profile, authenticated: true }));
    vi.spyOn(agents, 'accountProfiles').mockReturnValue(profiles);
    vi.spyOn(agents, 'refreshAccountProfile').mockResolvedValue(undefined);
    await flow.refreshAccountAfterLogin(input.id, terminal.id, false);
    expect(TestBed.inject(AccountLoginFeedbackService).get(terminal.id)?.phase).toBe('closed');
  });
});
