/** Keyboard events xterm does not translate into terminal input on its own. */

/** Reverse tab (CSI Z), what a terminal sends for Shift+Tab. */
export const REVERSE_TAB_SEQUENCE = '\x1b[Z';

/**
 * Escape, the key both Claude Code and Codex CLI advertise as "esc to interrupt".
 *
 * It stops the turn the agent is running without ending the session, so the transcript stays
 * resumable — unlike Ctrl+C, which quits the CLI.
 */
export const AGENT_INTERRUPT_SEQUENCE = '\x1b';

/** The four arrow keys in both forms; the application form is the one DECCKM selects. */
const CURSOR_KEY_SEQUENCES = {
  normal: { up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D' },
  application: { up: '\x1bOA', down: '\x1bOB', right: '\x1bOC', left: '\x1bOD' },
} as const;

export type CursorDirection = keyof typeof CURSOR_KEY_SEQUENCES.normal;

/**
 * The arrow keys as the program in the terminal currently expects them.
 *
 * A full-screen agent switches to application cursor keys, and an arrow sent in the other form
 * reaches it as a stray escape followed by letters instead of a move through its menu.
 */
export function cursorKeySequences(
  applicationCursorKeys: boolean,
): Readonly<Record<CursorDirection, string>> {
  return applicationCursorKeys ? CURSOR_KEY_SEQUENCES.application : CURSOR_KEY_SEQUENCES.normal;
}

/** A key on the touch keypad, which stands in for the keys a phone keyboard does not have. */
export type QuickKey = 'escape' | 'tab' | 'shiftTab' | 'enter' | 'ctrlC' | CursorDirection;

/** Every keypad key whose sequence does not depend on the terminal's modes. */
const FIXED_QUICK_KEY_SEQUENCES: Readonly<Record<Exclude<QuickKey, CursorDirection>, string>> = {
  escape: AGENT_INTERRUPT_SEQUENCE,
  tab: '\t',
  shiftTab: REVERSE_TAB_SEQUENCE,
  enter: '\r',
  // End of text: cancels the current input, and a second press quits an agent CLI.
  ctrlC: '\x03',
};

function isCursorDirection(key: QuickKey): key is CursorDirection {
  return key in CURSOR_KEY_SEQUENCES.normal;
}

/** The bytes a keypad key writes, matching what the same key on a real keyboard would send. */
export function quickKeySequence(key: QuickKey, applicationCursorKeys: boolean): string {
  return isCursorDirection(key)
    ? cursorKeySequences(applicationCursorKeys)[key]
    : FIXED_QUICK_KEY_SEQUENCES[key];
}

interface KeyLike {
  readonly type: string;
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Returns the sequence a key event should write to the PTY, or null to let xterm handle it.
 *
 * xterm 6 emits nothing for Shift+Tab, so agents that cycle modes with it — Claude Code among
 * them — never receive the key. Other modifier combinations are left alone: Ctrl+Shift+Tab is a
 * tab-switching shortcut, not terminal input.
 */
export function terminalKeySequence(event: KeyLike): string | null {
  if (event.type !== 'keydown' || event.key !== 'Tab' || !event.shiftKey) {
    return null;
  }
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return null;
  }
  return REVERSE_TAB_SEQUENCE;
}

/** Clipboard paste belongs to the terminal input, including full-screen agent prompts. */
export function terminalPasteShortcut(event: KeyLike): boolean {
  return (
    event.type === 'keydown' &&
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.toLowerCase() === 'v'
  );
}

/** The highest tab position `Alt`+digit can reach, one per digit key. */
const MAX_DIRECT_TAB_INDEX = 9;

/** A tab action the workbench performs instead of the focused terminal consuming the key. */
export type WorkbenchShortcut =
  /** Moves the selection `delta` tabs along the strip, wrapping at both ends. */
  | { readonly action: 'cycleTab'; readonly delta: -1 | 1 }
  /** Moves the active terminal itself `delta` positions along the strip. */
  | { readonly action: 'moveTab'; readonly delta: -1 | 1 }
  /** Selects the tab at this zero-based position. */
  | { readonly action: 'selectTab'; readonly index: number };

/**
 * Returns the workbench action a key event triggers, or null when the terminal owns the key.
 *
 * A focused terminal sees these combinations first. Recognising them here lets the panel refuse
 * them — so xterm never writes them to the PTY — while the shell acts on the same event as it
 * bubbles, without the two ends keeping separate lists that could drift apart.
 */
export function workbenchShortcut(event: KeyLike): WorkbenchShortcut | null {
  if (event.type !== 'keydown' || event.metaKey) {
    return null;
  }

  if (event.ctrlKey && !event.altKey) {
    if (event.key === 'Tab') {
      return { action: 'cycleTab', delta: event.shiftKey ? -1 : 1 };
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const delta = event.key === 'PageDown' ? 1 : -1;
      return { action: event.shiftKey ? 'moveTab' : 'cycleTab', delta };
    }
  }

  // Alt alone: Ctrl+Alt+digit is AltGr on several keyboard layouts and types a character.
  if (event.altKey && !event.ctrlKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    return index < MAX_DIRECT_TAB_INDEX ? { action: 'selectTab', index } : null;
  }

  return null;
}
