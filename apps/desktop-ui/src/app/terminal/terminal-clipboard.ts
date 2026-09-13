/**
 * The clipboard escape sequence programs use to copy text through their terminal.
 *
 * OpenCode keeps its own selection — it turns on mouse reporting, so a drag never reaches xterm's —
 * and copies it on Ctrl+C by sending `OSC 52`. xterm ignores the sequence unless told otherwise,
 * which left nothing to paste in a remote browser, whose clipboard only the terminal can reach.
 */

/** The operating system command number of a clipboard operation. */
export const OSC_CLIPBOARD = 52;

/** What a program sends in place of the data to read the clipboard, which is never answered. */
const CLIPBOARD_QUERY = '?';

/**
 * The text an `OSC 52` payload asks to put on the clipboard, or null when it asks for anything else.
 *
 * The payload is `<targets>;<base64 text>`. A query would hand the clipboard to whatever runs in
 * the terminal and an empty one would wipe it, so both are refused along with data that is not
 * valid base64.
 */
export function readClipboardWrite(payload: string): string | null {
  const separator = payload.indexOf(';');
  if (separator < 0) {
    return null;
  }
  const data = payload.slice(separator + 1);
  if (!data || data === CLIPBOARD_QUERY) {
    return null;
  }
  try {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    // Not base64: xterm's own reading of such a payload is to clear the selection, never to copy.
    return null;
  }
}
