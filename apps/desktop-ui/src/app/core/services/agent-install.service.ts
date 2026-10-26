import { inject, Injectable, signal } from '@angular/core';

import type {
  CliOperationPlan,
  CliOperationRequest,
  CliOperationResult,
} from '../models/agent.models';
import { AgentService } from './agent.service';

type InstallAction = 'check' | 'install' | 'repair';
export type InstallStage = 'idle' | 'checking' | 'installing';

/** Keeps an installation and its result alive when the settings window is closed. */
@Injectable({ providedIn: 'root' })
export class AgentInstallService {
  private readonly agents = inject(AgentService);
  readonly stage = signal<InstallStage>('idle');
  readonly request = signal<CliOperationRequest | null>(null);
  readonly plan = signal<CliOperationPlan | null>(null);
  readonly result = signal<CliOperationResult | null>(null);
  readonly error = signal<string | null>(null);
  private lastAction: InstallAction = 'check';

  matches(request: CliOperationRequest): boolean {
    const current = this.request();
    return (
      !!current &&
      current.agentType === request.agentType &&
      current.installer === request.installer &&
      (current.targetVersion || 'latest') === (request.targetVersion || 'latest') &&
      current.workspaceId === request.workspaceId
    );
  }

  check(request: CliOperationRequest): Promise<void> {
    return this.run(request, 'check');
  }

  install(request: CliOperationRequest, repair = false): Promise<void> {
    return this.run(request, repair ? 'repair' : 'install');
  }

  retry(): Promise<void> {
    const request = this.request();
    return request ? this.run(request, this.lastAction) : Promise.resolve();
  }

  private async run(request: CliOperationRequest, action: InstallAction): Promise<void> {
    if (this.stage() !== 'idle') return;
    const checkedPlan = this.matches(request) ? this.plan() : null;
    this.lastAction = action;
    this.request.set({ ...request });
    this.plan.set(null);
    this.result.set(null);
    this.error.set(null);
    this.stage.set('checking');
    try {
      // Execution revalidates the plan in the backend. Reuse a completed check so clicking
      // Update does not make the user wait for a redundant registry lookup first.
      const plan =
        action !== 'check' &&
        checkedPlan?.ready &&
        (checkedPlan.installer !== 'npm' || checkedPlan.resolvedVersion)
          ? checkedPlan
          : await this.agents.previewCliOperation(request);
      this.plan.set(plan);
      if (plan.ready && plan.installer === 'npm' && !plan.resolvedVersion) {
        throw new Error(
          'Could not query the available npm version. Check network or proxy settings and retry.',
        );
      }
      // A current, healthy installation needs no write. Repair is always a deliberate action.
      if (!plan.ready || action === 'check' || (plan.upToDate && action !== 'repair')) return;
      this.stage.set('installing');
      this.result.set(await this.agents.executeCliOperation({ ...request, confirmed: true }));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.stage.set('idle');
    }
  }
}
