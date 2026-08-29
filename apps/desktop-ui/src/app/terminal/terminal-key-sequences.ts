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
