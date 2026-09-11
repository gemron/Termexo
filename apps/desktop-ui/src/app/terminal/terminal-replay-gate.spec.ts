import { describe, expect, it } from 'vitest';

import { TerminalReplayGate } from './terminal-replay-gate';

describe('TerminalReplayGate', () => {
  it('lets answers through when no history is being redrawn', () => {
    expect(new TerminalReplayGate().replaying).toBe(false);
  });

  it('holds answers back while a replay is being parsed', () => {
    const gate = new TerminalReplayGate();
    gate.begin();

    expect(gate.replaying).toBe(true);
  });

  it('releases them once the replay has been parsed', () => {
    const gate = new TerminalReplayGate();
    gate.begin();
    gate.end();

    expect(gate.replaying).toBe(false);
  });

  it('stays closed until the last of several overlapping replays finishes', () => {
    const gate = new TerminalReplayGate();
    gate.begin();
    gate.begin();
    gate.end();

    expect(gate.replaying).toBe(true);

    gate.end();

    expect(gate.replaying).toBe(false);
  });

  it('ignores an end that answers no replay, so a stray callback cannot open it early', () => {
    const gate = new TerminalReplayGate();
    gate.end();
    gate.begin();

    expect(gate.replaying).toBe(true);
  });
});
