import {
  AGENT_INTERRUPT_SEQUENCE,
  quickKeySequence,
  REVERSE_TAB_SEQUENCE,
  terminalKeySequence,
  terminalPasteShortcut,
  workbenchShortcut,
} from './terminal-key-sequences';

describe('quickKeySequence', () => {
  it('sends the same bytes a keyboard would for the keys a phone lacks', () => {
    expect(quickKeySequence('escape', false)).toBe(AGENT_INTERRUPT_SEQUENCE);
    expect(quickKeySequence('shiftTab', false)).toBe(REVERSE_TAB_SEQUENCE);
    expect(quickKeySequence('tab', false)).toBe('\t');
    expect(quickKeySequence('enter', false)).toBe('\r');
    expect(quickKeySequence('ctrlC', false)).toBe('\x03');
  });

  it('sends arrows in the normal cursor-key form by default', () => {
    expect(quickKeySequence('up', false)).toBe('\x1b[A');
    expect(quickKeySequence('down', false)).toBe('\x1b[B');
    expect(quickKeySequence('right', false)).toBe('\x1b[C');
    expect(quickKeySequence('left', false)).toBe('\x1b[D');
  });

  it('switches arrows to the application form a full-screen agent asks for', () => {
    expect(quickKeySequence('up', true)).toBe('\x1bOA');
    expect(quickKeySequence('down', true)).toBe('\x1bOB');
    expect(quickKeySequence('right', true)).toBe('\x1bOC');
    expect(quickKeySequence('left', true)).toBe('\x1bOD');
  });

  it('keeps keys that have no application form unchanged under DECCKM', () => {
    expect(quickKeySequence('escape', true)).toBe(AGENT_INTERRUPT_SEQUENCE);
    expect(quickKeySequence('enter', true)).toBe('\r');
  });
});

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

describe('terminalPasteShortcut', () => {
  it('recognizes Ctrl+V and Ctrl+Shift+V only on keydown', () => {
    expect(terminalPasteShortcut(keyEvent({ key: 'v', ctrlKey: true, shiftKey: false }))).toBe(true);
    expect(terminalPasteShortcut(keyEvent({ key: 'V', ctrlKey: true }))).toBe(true);
    expect(terminalPasteShortcut(keyEvent({ key: 'v', ctrlKey: true, type: 'keyup' }))).toBe(false);
    expect(terminalPasteShortcut(keyEvent({ key: 'v', ctrlKey: true, altKey: true }))).toBe(false);
    expect(terminalPasteShortcut(keyEvent({ key: 'v', ctrlKey: false }))).toBe(false);
  });
});

describe('workbenchShortcut', () => {
  it('cycles tabs with Ctrl+Tab, backwards when Shift is held', () => {
    expect(workbenchShortcut(keyEvent({ ctrlKey: true, shiftKey: false }))).toEqual({
      action: 'cycleTab',
      delta: 1,
    });
    expect(workbenchShortcut(keyEvent({ ctrlKey: true }))).toEqual({
      action: 'cycleTab',
      delta: -1,
    });
  });

  it('cycles with Ctrl+PageUp/PageDown and moves the tab when Shift is added', () => {
    expect(
      workbenchShortcut(keyEvent({ key: 'PageDown', ctrlKey: true, shiftKey: false })),
    ).toEqual({ action: 'cycleTab', delta: 1 });
    expect(workbenchShortcut(keyEvent({ key: 'PageUp', ctrlKey: true }))).toEqual({
      action: 'moveTab',
      delta: -1,
    });
  });

  it('selects a tab by position with Alt and a digit', () => {
    expect(workbenchShortcut(keyEvent({ key: '3', altKey: true, shiftKey: false }))).toEqual({
      action: 'selectTab',
      index: 2,
    });
  });

  it('leaves Ctrl+Alt+digit to the keyboard layout, where it may be AltGr', () => {
    expect(
      workbenchShortcut(keyEvent({ key: '3', altKey: true, ctrlKey: true, shiftKey: false })),
    ).toBeNull();
  });

  it('claims nothing the terminal itself uses', () => {
    expect(workbenchShortcut(keyEvent())).toBeNull();
    expect(workbenchShortcut(keyEvent({ key: 'Enter', ctrlKey: true }))).toBeNull();
    expect(workbenchShortcut(keyEvent({ ctrlKey: true, type: 'keyup' }))).toBeNull();
  });
});
