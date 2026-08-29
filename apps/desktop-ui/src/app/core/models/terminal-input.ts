/**
 * How Termexo hands a prepared prompt to an Agent terminal.
 *
 * Claude Code and Codex CLI both read their input as whole PTY chunks, so a clear key, a bracketed
 * paste and the Enter that submits it collapse into a single keystroke when they travel in one
 * write: the agent either keeps the Enter as pasted text and never runs the prompt, or honours only
 * the leading clear key and drops everything after it. Writing them apart, with a pause for the
 * terminal UI to repaint, keeps every step its own key event.
 */

/** How long to wait between the writes that make up one prompt delivery. */
export const TERMINAL_INPUT_SETTLE_MS = 120;
/** Ctrl+U, so a prompt never lands behind whatever the input already held. */
export const TERMINAL_CLEAR_INPUT_KEY = '\x15';
/** Enter, which submits whatever the input currently holds. */
export const TERMINAL_SUBMIT_KEY = '\r';

const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
/** Control characters an agent input cannot represent; newlines survive inside a paste. */
const UNSUPPORTED_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Wraps a prompt so multi-line text arrives as one insertion instead of many submissions. */
export function bracketedPaste(content: string): string {
  const safeContent = content.replace(/\r\n?/g, '\n').replace(UNSUPPORTED_CONTROL, '');
  return `${BRACKETED_PASTE_START}${safeContent}${BRACKETED_PASTE_END}`;
}

/** The ordered writes that place `content` in an Agent input, optionally submitting it. */
export function terminalPromptWrites(content: string, submit: boolean): string[] {
  const writes = [TERMINAL_CLEAR_INPUT_KEY, bracketedPaste(content)];
  return submit ? [...writes, TERMINAL_SUBMIT_KEY] : writes;
}
