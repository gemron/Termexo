import { Injectable, signal } from '@angular/core';

import {
  AGENT_STARTUP_MAX_CONFIRMATIONS,
  AGENT_STARTUP_QUIET_MS,
  AGENT_STARTUP_SETTLE_FLOOR_MS,
  AGENT_STARTUP_TIMEOUT_MS,
  isAgentReadyForPrompt,
  isStartupConfirmation,
  normalizeStartupFrame,
} from '../models/agent-startup';

export interface AgentStartupRequest {
  /** Answers a startup dialog by accepting the option the CLI already highlights. */
  confirm: () => Promise<void>;
  /** Hands the task prompt to the agent once its input is ready to receive one. */
  submit: () => Promise<void>;
  onFailed: (message: string) => void;
}

interface PendingStartup extends AgentStartupRequest {
  frame: string;
  confirmations: number;
  submitting: boolean;
  /** When the PTY reported itself started, or undefined while the terminal is still launching. */
  startedAt?: number;
  quietTimer?: number;
  deadlineTimer?: number;
}

/**
 * Drives a freshly launched agent terminal from "PTY started" to "prompt accepted".
 *
 * Both CLIs open with a folder-trust dialog and seconds of banner output, so a prompt written
 * right after the PTY starts is swallowed by that dialog. This service watches the output instead,
 * answers the startup dialogs, and submits the prompt only once the agent is actually listening.
 *
 * Nothing is timed until {@link markRuntimeStarted}: arming happens as soon as the terminal record
 * exists, which is several seconds before the PTY is spawned, and a clock started that early would
 * spend its budget on the launch itself.
 */
@Injectable({ providedIn: 'root' })
export class AgentStartupService {
  private readonly pending = new Map<string, PendingStartup>();
  private readonly pendingIds = signal<readonly string[]>([]);

  /** Terminals still waiting for their prompt, so callers can explain the delay. */
  readonly awaitingTerminalIds = this.pendingIds.asReadonly();

  arm(terminalId: string, request: AgentStartupRequest): void {
    this.cancel(terminalId);
    this.pending.set(terminalId, { ...request, frame: '', confirmations: 0, submitting: false });
    this.publishPendingIds();
  }

  /** Starts the clocks once the PTY is up; ignored for terminals with no prompt waiting. */
  markRuntimeStarted(terminalId: string): void {
    const entry = this.pending.get(terminalId);
    if (!entry || entry.startedAt !== undefined) return;
    entry.startedAt = Date.now();
    // An agent that never paints a recognisable frame still has to receive its prompt eventually.
    entry.deadlineTimer = window.setTimeout(
      () => this.submit(terminalId),
      AGENT_STARTUP_TIMEOUT_MS,
    );
    // Output that arrived while the PTY was still starting has had no check scheduled for it.
    if (entry.frame) {
      this.scheduleSettledCheck(terminalId, entry);
    }
  }

  ingest(terminalId: string, data: string): void {
    const entry = this.pending.get(terminalId);
    if (!entry) return;
    entry.frame = normalizeStartupFrame(entry.frame, data);
    // Before the PTY reports started there is no deadline to race, so the frame is only collected.
    if (entry.startedAt !== undefined) {
      this.scheduleSettledCheck(terminalId, entry);
    }
  }

  cancel(terminalId: string): void {
    const entry = this.pending.get(terminalId);
    if (!entry) return;
    this.clearTimers(entry);
    this.pending.delete(terminalId);
    this.publishPendingIds();
  }

  private scheduleSettledCheck(
    terminalId: string,
    entry: PendingStartup,
    delay = AGENT_STARTUP_QUIET_MS,
  ): void {
    window.clearTimeout(entry.quietTimer);
    entry.quietTimer = window.setTimeout(() => this.handleSettledFrame(terminalId), delay);
  }

  private handleSettledFrame(terminalId: string): void {
    const entry = this.pending.get(terminalId);
    if (!entry) return;

    if (
      isStartupConfirmation(entry.frame) &&
      entry.confirmations < AGENT_STARTUP_MAX_CONFIRMATIONS
    ) {
      entry.confirmations += 1;
      entry.frame = '';
      // A dialog that closes without repainting would otherwise wait out the deadline.
      this.scheduleSettledCheck(terminalId, entry);
      void this.run(terminalId, entry, entry.confirm);
      return;
    }

    // A composer on screen is proof the agent reads stdin; anything else is only silence, which a
    // CLI still loading produces just as readily, so it has to outlast the floor first.
    const elapsed = Date.now() - (entry.startedAt ?? Date.now());
    if (isAgentReadyForPrompt(entry.frame) || elapsed >= AGENT_STARTUP_SETTLE_FLOOR_MS) {
      this.submit(terminalId);
      return;
    }
    this.scheduleSettledCheck(terminalId, entry, AGENT_STARTUP_SETTLE_FLOOR_MS - elapsed);
  }

  private submit(terminalId: string): void {
    const entry = this.pending.get(terminalId);
    if (!entry || entry.submitting) return;
    entry.submitting = true;
    this.clearTimers(entry);
    void this.run(terminalId, entry, entry.submit).finally(() => {
      if (this.pending.get(terminalId) !== entry) return;
      this.pending.delete(terminalId);
      this.publishPendingIds();
    });
  }

  private async run(
    terminalId: string,
    entry: PendingStartup,
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.cancel(terminalId);
      entry.onFailed(error instanceof Error ? error.message : String(error));
    }
  }

  private clearTimers(entry: PendingStartup): void {
    window.clearTimeout(entry.quietTimer);
    window.clearTimeout(entry.deadlineTimer);
  }

  private publishPendingIds(): void {
    this.pendingIds.set([...this.pending.keys()]);
  }
}
