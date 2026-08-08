import { REVERSE_TAB_SEQUENCE, terminalKeySequence } from './terminal-key-sequences';

function keyEvent(overrides: Partial<Parameters<typeof terminalKeySequence>[0]> = {}) {
  return {
    type: 'keydown',
    key: 'Tab',
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('terminalKeySequence', () => {
  it('sends reverse tab for Shift+Tab, which xterm itself never emits', () => {
    expect(terminalKeySequence(keyEvent())).toBe(REVERSE_TAB_SEQUENCE);
  });

  it('leaves plain Tab to xterm', () => {
    expect(terminalKeySequence(keyEvent({ shiftKey: false }))).toBeNull();
  });

  it('ignores keyup so the sequence is sent once per press', () => {
    expect(terminalKeySequence(keyEvent({ type: 'keyup' }))).toBeNull();
  });

  it('leaves Ctrl+Shift+Tab alone, since that switches tabs rather than typing', () => {
    expect(terminalKeySequence(keyEvent({ ctrlKey: true }))).toBeNull();
    expect(terminalKeySequence(keyEvent({ altKey: true }))).toBeNull();
    expect(terminalKeySequence(keyEvent({ metaKey: true }))).toBeNull();
  });

  it('ignores other keys', () => {
    expect(terminalKeySequence(keyEvent({ key: 'Enter' }))).toBeNull();
  });
});
