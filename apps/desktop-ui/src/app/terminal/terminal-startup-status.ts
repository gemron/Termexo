import type { TerminalSession, TerminalStatus } from '../core/models/workspace.models';

/** Codex opens its input prompt; starting a new or resumed process does not begin a turn. */
export function terminalStatusAfterStart(
  session: Pick<TerminalSession, 'agentType' | 'nativeSessionId' | 'status'>,
): TerminalStatus | null {
  // A hook or submitted prompt may already have reported a newer state during startup.
  if (session.status !== 'STARTING') return null;
  return session.agentType === 'codex' ? 'IDLE' : 'RUNNING';
}

/** A display correction, never an interrupt or a completion of the underlying process. */
export function canSetTerminalIdle(
  session: Pick<TerminalSession, 'status' | 'commonActionId'>,
): boolean {
  // Common operations use their running state to prevent duplicate service launches.
  return !session.commonActionId && ['RUNNING', 'THINKING'].includes(session.status);
}
