import type { TerminalSession, TerminalStatus } from '../core/models/workspace.models';

/** A resumed Codex opens its input prompt; starting its process does not resume a turn. */
export function terminalStatusAfterStart(
  session: Pick<TerminalSession, 'agentType' | 'nativeSessionId' | 'status'>,
): TerminalStatus | null {
  // A hook or submitted prompt may already have reported a newer state during startup.
  if (session.status !== 'STARTING') return null;
  return session.agentType === 'codex' && session.nativeSessionId ? 'IDLE' : 'RUNNING';
}
