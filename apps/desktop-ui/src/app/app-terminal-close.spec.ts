import { type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './app';
import { AppStateService } from './core/services/app-state.service';
import { RemoteConnectionService } from './core/services/remote-connection.service';
import { TerminalGatewayService } from './core/services/terminal-gateway.service';
import { WorkspaceRepository } from './core/services/workspace.repository';

interface CloseFlow {
  closeTerminal(id: string): Promise<boolean>;
  confirmCloseTerminal(id: string): void;
  closeTodoTerminal(id: string): Promise<void>;
  closingTerminal: WritableSignal<boolean>;
  showToast(message: string, tone?: string): void;
}

describe('confirmed terminal shutdown', () => {
  let flow: CloseFlow;
  let state: AppStateService;
  let gateway: TerminalGatewayService;

  beforeEach(async () => {
    vi.spyOn(App.prototype as unknown as { initialize(): Promise<void> }, 'initialize').mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [
      { provide: WorkspaceRepository, useValue: { save: vi.fn().mockResolvedValue(undefined) } },
    ] });
    TestBed.overrideComponent(App, { set: { template: '' } });
    await TestBed.compileComponents();
    flow = TestBed.createComponent(App).componentInstance as unknown as CloseFlow;
    state = TestBed.inject(AppStateService);
    gateway = TestBed.inject(TerminalGatewayService);
    await state.createWorkspace('Project', 'D:/project');
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps the console visible until the backend confirms shutdown', async () => {
    const terminal = state.createTerminal({ agentType: 'shell' })!;
    let finish!: () => void;
    vi.spyOn(gateway, 'close').mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const closed = flow.closeTerminal(terminal.id);
    expect(state.activeWorkspace()!.terminals.some((item) => item.id === terminal.id)).toBe(true);
    finish();
    await closed;
    expect(state.activeWorkspace()!.terminals.some((item) => item.id === terminal.id)).toBe(false);
  });

  it('shows a real close error and preserves the console so closing can be retried', async () => {
    const terminal = state.createTerminal({ agentType: 'shell' })!;
    const close = vi.spyOn(gateway, 'close').mockRejectedValueOnce(new Error('shutdown denied'));
    const toast = vi.spyOn(flow, 'showToast');
    await flow.closeTerminal(terminal.id);
    expect(toast).toHaveBeenCalledWith('shutdown denied', 'error');
    expect(state.activeWorkspace()!.terminals.some((item) => item.id === terminal.id)).toBe(true);
    close.mockResolvedValue(undefined);
    await flow.closeTerminal(terminal.id);
    expect(state.activeWorkspace()!.terminals).toHaveLength(0);
  });

  it('allows another console to close while an earlier shutdown is pending', async () => {
    const first = state.createTerminal({ agentType: 'shell' })!;
    const second = state.createTerminal({ agentType: 'shell' })!;
    const pending = new Map<string, () => void>();
    const close = vi.spyOn(gateway, 'close').mockImplementation((id) =>
      new Promise<void>((resolve) => { pending.set(id, resolve); }));
    flow.confirmCloseTerminal(first.id);
    expect(flow.closingTerminal()).toBe(true);
    await Promise.resolve();
    expect(flow.closingTerminal()).toBe(false);
    flow.confirmCloseTerminal(second.id);
    expect(close).toHaveBeenCalledTimes(2);
    expect(state.activeWorkspace()!.terminals).toHaveLength(2);
    pending.forEach((finish) => finish());
    await vi.waitFor(() => expect(state.activeWorkspace()!.terminals).toHaveLength(0));
  });

  it('does not announce that a task console closed when shutdown failed', async () => {
    const terminal = state.createTerminal({ agentType: 'shell' })!;
    vi.spyOn(gateway, 'close').mockRejectedValue(new Error('shutdown denied'));
    const toast = vi.spyOn(flow, 'showToast');
    await flow.closeTodoTerminal(terminal.id);
    expect(toast).toHaveBeenCalledExactlyOnceWith('shutdown denied', 'error');
    expect(state.activeWorkspace()!.terminals.some((item) => item.id === terminal.id)).toBe(true);
  });

  it('does not remove terminals in read-only mode', async () => {
    const terminal = state.createTerminal({ agentType: 'shell' })!;
    vi.spyOn(TestBed.inject(RemoteConnectionService), 'readOnly').mockReturnValue(true);
    const close = vi.spyOn(gateway, 'close');
    await flow.closeTerminal(terminal.id);
    expect(close).not.toHaveBeenCalled();
    expect(state.activeWorkspace()!.terminals.some((item) => item.id === terminal.id)).toBe(true);
  });
});
