/** Keyboard events xterm does not translate into terminal input on its own. */

/** Reverse tab (CSI Z), what a terminal sends for Shift+Tab. */
export const REVERSE_TAB_SEQUENCE = '\x1b[Z';

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
