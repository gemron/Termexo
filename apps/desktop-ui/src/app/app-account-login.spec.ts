import type { Signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import type { AccountProfileInput } from './core/models/agent.models';
import { AgentService } from './core/services/agent.service';
import { AppStateService } from './core/services/app-state.service';
import { WorkspaceRepository } from './core/services/workspace.repository';

interface AccountLoginFlow {
  loginAccount(input: AccountProfileInput): Promise<void>;
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
});
