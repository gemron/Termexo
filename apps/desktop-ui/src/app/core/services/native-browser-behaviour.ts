/**
 * Takes away the browser behaviours a desktop window has no use for.
 *
 * The window is a WebView2, so it arrives with a browser's own menu and accelerators: Back,
 * Reload, Save as and Print. None of them mean anything here, and reload is worse than useless —
 * it throws away the workbench and rebuilds it from scratch while the terminals keep running.
 */

/**
 * Fields whose menu carries editing commands nothing here replaces.
 *
 * Cut, copy, paste and select-all are the reason to right-click a text field at all, and Termexo
 * offers no menu of its own to put them in.
 */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"]';

/** Letters Chromium turns into a browser action when Ctrl is held: reload, save page, print. */
const BROWSER_CONTROL_KEYS = new Set(['r', 's', 'p']);

/** The arrows Alt turns into history navigation, which would leave the workbench entirely. */
const HISTORY_KEYS = new Set(['ArrowLeft', 'ArrowRight']);

/** The parts of a key press that decide whether the browser would act on it. */
export interface BrowserShortcutKey {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** Whether the press is one the browser would answer itself rather than pass to the page. */
export function isBrowserShortcut(event: BrowserShortcutKey): boolean {
  if (event.metaKey) {
    return false;
  }
  // F5 with or without Ctrl, which is reload either way.
  if (event.key === 'F5') {
    return true;
  }
  if (event.altKey) {
    return !event.ctrlKey && HISTORY_KEYS.has(event.key);
  }
  // Shift is deliberately not checked: Ctrl+Shift+R is the hard reload, and just as unwelcome.
  return event.ctrlKey && BROWSER_CONTROL_KEYS.has(event.key.toLowerCase());
}

/** Whether the press landed in a field that should keep the browser's editing menu. */
function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null;
}

/**
 * Stops WebView2 acting as a browser inside the desktop window, and returns a disposer.
 *
 * Both listeners sit on the bubble phase so anything that claims a key or a click first — xterm
 * writing Ctrl+R to the shell as reverse search, the terminal's own copy-and-paste on the right
 * button — has already acted by the time the browser's turn is refused.
 */
export function suppressNativeBrowserBehaviour(target: Document = document): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    if (!isEditable(event.target)) {
      event.preventDefault();
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isBrowserShortcut(event)) {
      event.preventDefault();
    }
  };

  target.addEventListener('contextmenu', onContextMenu);
  target.addEventListener('keydown', onKeyDown);
  return () => {
    target.removeEventListener('contextmenu', onContextMenu);
    target.removeEventListener('keydown', onKeyDown);
  };
}
