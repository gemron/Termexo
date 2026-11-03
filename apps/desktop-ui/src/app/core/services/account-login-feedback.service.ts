import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { AccountProfile } from '../models/agent.models';

export type LoginPhase = 'waiting' | 'verifying' | 'rejected' | 'timeout' | 'closed' | 'success' | 'restarting';
export interface LoginFeedback {
  profileId: string;
  profileName: string;
  phase: LoginPhase;
  previouslyAuthenticated: boolean;
  successObserved: boolean;
}

/** Ephemeral login feedback, keyed by the exact PTY. Never stores authorization codes. */
@Injectable({ providedIn: 'root' })
export class AccountLoginFeedbackService {
  private readonly entries = signal<Record<string, LoginFeedback>>({});
  private readonly tails = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const timer of this.timers.values()) clearTimeout(timer);
    });
  }

  get(id: string): LoginFeedback | undefined { return this.entries()[id]; }

  begin(id: string, profile: AccountProfile): void {
    this.clearTimer(id);
    this.tails.delete(id);
    this.entries.update((entries) => ({ ...entries, [id]: {
      profileId: profile.id, profileName: profile.name, phase: 'waiting',
      previouslyAuthenticated: profile.authenticated, successObserved: false,
    } }));
  }

  verifying(id: string): void {
    this.tails.delete(id);
    this.setPhase(id, 'verifying');
    this.clearTimer(id);
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      if (this.get(id)?.phase === 'verifying') this.setPhase(id, 'timeout');
    }, 30_000));
  }

  observeOutput(id: string, data: string): void {
    const entry = this.get(id);
    if (!entry || ['success', 'closed', 'restarting'].includes(entry.phase)) return;
    // Strip terminal styling and retain only a small transient window for split output chunks.
    const tail = ((this.tails.get(id) ?? '') + data).slice(-4096);
    this.tails.set(id, tail);
    const text = tail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
    if (/invalid[_ ]grant|(?:invalid|expired|incorrect)\s+(?:authorization\s+|authentication\s+|oauth\s+)?code|(?:authorization|authentication|oauth)\s+(?:code\s+)?(?:failed|error)|(?:error|failed)\s+(?:to\s+)?(?:exchange|exchanging)\s+(?:the\s+)?(?:authorization\s+)?(?:code|token)|code\s+(?:is\s+)?(?:invalid|expired|incorrect)/i.test(text)) {
      this.setPhase(id, 'rejected');
    } else if (/(?:login|authentication|authorization)\s+(?:was\s+)?successful|successfully\s+(?:logged|signed)\s+in/i.test(text)) {
      this.entries.update((entries) => ({ ...entries, [id]: { ...entries[id], successObserved: true } }));
    }
  }

  /** Old credentials alone do not prove that a new attempt succeeded. */
  confirm(id: string, authenticated: boolean, successfulExit = false): boolean {
    const entry = this.get(id);
    if (!entry || !authenticated || ['rejected', 'closed', 'restarting'].includes(entry.phase)) return false;
    if (entry.previouslyAuthenticated && !entry.successObserved && !successfulExit) return false;
    this.setPhase(id, 'success');
    return true;
  }

  setPhase(id: string, phase: LoginPhase): void {
    if (!this.get(id)) return;
    if (phase !== 'verifying') this.clearTimer(id);
    if (['closed', 'success', 'restarting'].includes(phase)) this.tails.delete(id);
    this.entries.update((entries) => ({ ...entries, [id]: { ...entries[id], phase } }));
  }

  forget(id: string): void {
    this.clearTimer(id);
    this.tails.delete(id);
    this.entries.update(({ [id]: _removed, ...entries }) => entries);
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }
}
