import { DestroyRef, inject, Injectable, InjectionToken } from '@angular/core';
import { invoke, listen, type UnlistenFn } from './backend-bridge';
import { runtimeMode } from './tauri-runtime';
import { AppStateService } from './app-state.service';
import { TerminalGatewayService } from './terminal-gateway.service';
import { WorkspaceRepository } from './workspace.repository';
import type { TerminalSession } from '../models/workspace.models';

export interface OneRingWorkerRequest {
  id: string;
  workspaceId: string;
  hostTerminalId: string;
  title: string;
  cwd: string;
  command: string;
  deadline: number;
}

export const ONE_RING_DESKTOP_BRIDGE = new InjectionToken('ONE_RING_DESKTOP_BRIDGE', {
  providedIn: 'root',
  factory: () => ({ invoke, listen, mode: runtimeMode }),
});

@Injectable({ providedIn: 'root' })
export class OneRingDesktopService {
  private readonly state = inject(AppStateService);
  private readonly gateway = inject(TerminalGatewayService);
  private readonly repository = inject(WorkspaceRepository);
  private readonly bridge = inject(ONE_RING_DESKTOP_BRIDGE);
  private readonly destroy = inject(DestroyRef);
  private unlisten?: UnlistenFn;

  async start(reveal: (workspaceId: string, terminalId: string) => void): Promise<void> {
    if (this.bridge.mode() !== 'desktop' || this.unlisten) return;
    this.unlisten = await this.bridge.listen<OneRingWorkerRequest>(
      'one-ring-worker-open',
      ({ payload }) => {
        void this.open(payload, reveal);
      },
    );
    this.destroy.onDestroy(() => this.unlisten?.());
  }

  private async open(
    request: OneRingWorkerRequest,
    reveal: (workspaceId: string, terminalId: string) => void,
  ): Promise<void> {
    let terminal: TerminalSession | null = null;
    let error: string | null = null;
    try {
      if (Date.now() > request.deadline) throw new Error('One Ring 终端请求已过期。');
      const workspace = this.state.workspaces().find((item) => item.id === request.workspaceId);
      if (!workspace?.terminals.some((item) => item.id === request.hostTerminalId))
        throw new Error('One Ring Host 终端已关闭。');
      terminal = this.state.createTerminal(
        {
          agentType: 'shell',
          name: request.title,
          command: request.command,
          workingDirectory: request.cwd,
        },
        workspace.id,
      );
      if (!terminal) throw new Error('无法创建 One Ring Worker 终端。');
      await this.gateway.start(terminal, 120, 30, workspace.id);
      await this.repository.flush();
      reveal(workspace.id, terminal.id);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      if (terminal) await this.cleanup(terminal);
    }
    try {
      await this.bridge.invoke('complete_one_ring_worker', { id: request.id, error });
    } catch {
      if (terminal) await this.cleanup(terminal);
    }
  }

  private async cleanup(terminal: TerminalSession): Promise<void> {
    try {
      await this.gateway.close(terminal.id);
      this.state.removeTerminal(terminal.id);
    } catch (error) {
      console.error('One Ring Worker 终端清理失败：', error);
    }
  }
}
