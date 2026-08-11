import { terminalEventMatchesSession } from './terminal-gateway.service';

describe('terminal runtime event matching', () => {
  it('accepts events from the active PTY revision', () => {
    expect(
      terminalEventMatchesSession(
        { terminalId: 'terminal-1', runtimeRevision: 2 },
        { id: 'terminal-1', runtimeRevision: 2 },
      ),
    ).toBe(true);
  });

  it('rejects delayed events from the PTY replaced during a model switch', () => {
    expect(
      terminalEventMatchesSession(
        { terminalId: 'terminal-1', runtimeRevision: 1 },
        { id: 'terminal-1', runtimeRevision: 2 },
      ),
    ).toBe(false);
  });

  it('treats a missing persisted revision as the initial PTY revision', () => {
    expect(
      terminalEventMatchesSession(
        { terminalId: 'terminal-1', runtimeRevision: 0 },
        { id: 'terminal-1' },
      ),
    ).toBe(true);
  });
});
