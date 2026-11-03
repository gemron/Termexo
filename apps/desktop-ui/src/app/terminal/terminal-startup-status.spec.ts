import { canSetTerminalIdle, terminalStatusAfterStart } from './terminal-startup-status';
import { TerminalInputStatusTracker } from './terminal-input-status';
import type { TerminalStatus } from '../core/models/workspace.models';

describe('terminal startup status', () => {
  it.each([undefined, 'saved-session'])(
    'opens new or resumed Codex idle (%s) until a prompt is submitted',
    (nativeSessionId) => {
      const status = terminalStatusAfterStart({
        agentType: 'codex',
        nativeSessionId,
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
    },
  );

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

  it('keeps other agents on their existing startup path', () => {
    for (const agentType of ['shell', 'claude', 'grok', 'pi', 'antigravity', 'opencode'] as const) {
      expect(
        terminalStatusAfterStart({
          agentType,
          nativeSessionId: 'saved-session',
          status: 'STARTING',
        }),
      ).toBe('RUNNING');
    }
  });

  it('offers a manual idle correction only for working terminals, excluding managed services', () => {
    for (const status of ['RUNNING', 'THINKING'] as const) {
      expect(canSetTerminalIdle({ status })).toBe(true);
      expect(canSetTerminalIdle({ status, commonActionId: 'service' })).toBe(false);
    }
    for (const status of [
      'STARTING',
      'IDLE',
      'COMPLETED',
      'WAITING_APPROVAL',
      'WAITING_INPUT',
      'FAILED',
      'RATE_LIMITED',
      'STOPPED',
      'DISCONNECTED',
    ] as const)
      expect(canSetTerminalIdle({ status })).toBe(false);
  });
});
