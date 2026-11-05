import { TestBed } from '@angular/core/testing';
import { describe, it, beforeEach, expect, vi } from 'vitest';
import { AppStateService } from './app-state.service';
import { TerminalGatewayService } from './terminal-gateway.service';
import { WorkspaceRepository } from './workspace.repository';
import {
  ONE_RING_DESKTOP_BRIDGE,
  OneRingDesktopService,
  type OneRingWorkerRequest,
} from './one-ring-desktop.service';

describe('One Ring desktop presentation', () => {
  let handler: (event: { payload: OneRingWorkerRequest }) => void;
  const worker = { id: 'worker' };
  const state = {
    workspaces: () => [{ id: 'workspace', terminals: [{ id: 'host' }] }],
    createTerminal: vi.fn(),
    removeTerminal: vi.fn(),
  };
  const gateway = { start: vi.fn(), close: vi.fn() };
  const bridge = {
    invoke: vi.fn(),
    mode: () => 'desktop',
    listen: async (_name: string, next: typeof handler) => {
      handler = next;
      return () => {};
    },
  };
  const reveal = vi.fn();
  const request = (): OneRingWorkerRequest => ({
    id: 'request',
    workspaceId: 'workspace',
    hostTerminalId: 'host',
    title: 'One Ring · Reader',
    cwd: '/project',
    command: 'exec node runner',
    deadline: Date.now() + 10000,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    state.createTerminal.mockReturnValue(worker);
    gateway.start.mockResolvedValue({});
    gateway.close.mockResolvedValue(undefined);
    bridge.invoke.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: AppStateService, useValue: state },
        { provide: TerminalGatewayService, useValue: gateway },
        { provide: WorkspaceRepository, useValue: { flush: vi.fn().mockResolvedValue(undefined) } },
        { provide: ONE_RING_DESKTOP_BRIDGE, useValue: bridge },
      ],
    });
    await TestBed.inject(OneRingDesktopService).start(reveal);
  });

  it('opens a shell PTY in its Host workspace without preparing another Agent launch', async () => {
    handler({ payload: request() });
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('complete_one_ring_worker', {
        id: 'request',
        error: null,
      }),
    );
    expect(state.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'shell',
        name: 'One Ring · Reader',
        workingDirectory: '/project',
      }),
      'workspace',
    );
    expect(gateway.start).toHaveBeenCalledWith(worker, 120, 30, 'workspace');
    expect(reveal).toHaveBeenCalledWith('workspace', 'worker');
  });
  it('rejects expired and orphaned requests before creating a terminal', async () => {
    handler({ payload: { ...request(), deadline: 0 } });
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('complete_one_ring_worker', {
        id: 'request',
        error: 'One Ring 终端请求已过期。',
      }),
    );
    handler({ payload: { ...request(), id: 'orphan', hostTerminalId: 'closed' } });
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('complete_one_ring_worker', {
        id: 'orphan',
        error: 'One Ring Host 终端已关闭。',
      }),
    );
    expect(gateway.start).not.toHaveBeenCalled();
  });
  it('cleans up a tab if PTY startup or acknowledgement fails', async () => {
    gateway.start.mockRejectedValueOnce(new Error('PTY failed'));
    handler({ payload: request() });
    await vi.waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('complete_one_ring_worker', {
        id: 'request',
        error: 'PTY failed',
      }),
    );
    expect(gateway.close).toHaveBeenCalledWith('worker');
    expect(state.removeTerminal).toHaveBeenCalledWith('worker');
    gateway.close.mockClear();
    bridge.invoke.mockRejectedValueOnce(new Error('Expired'));
    handler({ payload: { ...request(), id: 'late' } });
    await vi.waitFor(() => expect(gateway.close).toHaveBeenCalledWith('worker'));
  });
});
