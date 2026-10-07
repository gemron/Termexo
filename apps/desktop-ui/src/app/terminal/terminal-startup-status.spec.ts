import { terminalStatusAfterStart } from './terminal-startup-status';
import { TerminalInputStatusTracker } from './terminal-input-status';
import type { TerminalStatus } from '../core/models/workspace.models';

describe('terminal startup status', () => {
  it('restores Codex to idle and starts thinking only when the user submits a prompt', () => {
    const status = terminalStatusAfterStart({
      agentType: 'codex',
      nativeSessionId: 'saved-session',
      status: 'STARTING',
    });
    expect(status).toBe('IDLE');
    const input = new TerminalInputStatusTracker();
    expect(
      input.statusAfterInput('\r', {
        agentType: 'codex',
        status: status!,
        readApprovalOptions: () => [],
      }),
    ).toBe('THINKING');
  });

  it('preserves events received while the resumed process is starting', () => {
    const statuses: TerminalStatus[] = [
      'THINKING',
      'RUNNING',
      'WAITING_APPROVAL',
      'WAITING_INPUT',
      'IDLE',
      'COMPLETED',
      'FAILED',
      'STOPPED',
      'DISCONNECTED',
      'RATE_LIMITED',
    ];
    for (const status of statuses) {
      expect(
        terminalStatusAfterStart({
          agentType: 'codex',
          nativeSessionId: 'saved-session',
          status,
        }),
      ).toBeNull();
    }
  });

  it('keeps other agents and a new Codex launch on their existing startup path', () => {
    for (const agentType of ['shell', 'claude', 'grok', 'antigravity', 'opencode'] as const) {
      expect(
        terminalStatusAfterStart({
          agentType,
          nativeSessionId: 'saved-session',
          status: 'STARTING',
        }),
      ).toBe('RUNNING');
    }
    expect(
      terminalStatusAfterStart({
        agentType: 'codex',
        nativeSessionId: undefined,
        status: 'STARTING',
      }),
    ).toBe('RUNNING');
  });
});
