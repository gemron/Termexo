import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { CLI_NATIVE_PROFILE_ID } from './core/models/launch-model-choice';
import { AgentService } from './core/services/agent.service';
import { AppStateService } from './core/services/app-state.service';
import { TerminalGatewayService } from './core/services/terminal-gateway.service';
import { WorkspaceRepository } from './core/services/workspace.repository';

describe('model switching from a terminal tab', () => {
  let app: App;
  let state: AppStateService;
  let agents: AgentService;
  let gateway: TerminalGatewayService;

  beforeEach(async () => {
    vi.spyOn(
      App.prototype as unknown as { initialize(): Promise<void> },
      'initialize',
    ).mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: WorkspaceRepository, useValue: { save: vi.fn().mockResolvedValue(undefined) } },
      ],
    });
    TestBed.overrideComponent(App, { set: { template: '' } });
    await TestBed.compileComponents();
    app = TestBed.createComponent(App).componentInstance;
    state = TestBed.inject(AppStateService);
    agents = TestBed.inject(AgentService);
    gateway = TestBed.inject(TerminalGatewayService);
    await state.createWorkspace('Demo', '/demo');
  });

  afterEach(() => vi.restoreAllMocks());

  it('changes only the selected Codex terminal and preserves its account', async () => {
    const target = state.createTerminal({
      agentType: 'codex',
      accountProfileId: 'personal',
      profileId: CLI_NATIVE_PROFILE_ID,
      model: 'first',
      command: 'codex',
    })!;
    const neighbor = state.createTerminal({ agentType: 'codex', model: 'other' })!;
    const prepare = vi.spyOn(agents, 'prepareCodexLaunch').mockResolvedValue({
      command: 'codex --model second',
      executablePath: 'codex',
    });
    const close = vi.spyOn(gateway, 'close').mockResolvedValue(undefined);
    app['openSingleModelSwitch'](target.id);
    const choice = { agent: 'codex' as const, profileId: CLI_NATIVE_PROFILE_ID, model: 'second' };
    await app['switchModels'](choice);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalId: target.id,
        profileId: CLI_NATIVE_PROFILE_ID,
        model: 'second',
        accountProfileId: 'personal',
      }),
    );
    expect(close).toHaveBeenCalledExactlyOnceWith(target.id, true);
    expect(state.activeWorkspace()!.terminals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: target.id, model: 'second', accountProfileId: 'personal' }),
        neighbor,
      ]),
    );
    app['openSingleModelSwitch'](target.id);
    await app['switchModels'](choice);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves the running terminal intact when launch preparation fails', async () => {
    const target = state.createTerminal({ agentType: 'claude', model: 'sonnet' })!;
    const close = vi.spyOn(gateway, 'close');
    vi.spyOn(agents, 'prepareLaunch').mockRejectedValue(new Error('unavailable'));
    app['openSingleModelSwitch'](target.id);
    await app['switchModels']({ agent: 'claude', profileId: CLI_NATIVE_PROFILE_ID, model: 'opus' });
    expect(close).not.toHaveBeenCalled();
    expect(state.activeWorkspace()!.terminals).toEqual([target]);
    expect(app['modelSwitchOpen']()).toBe(true);
  });
});
