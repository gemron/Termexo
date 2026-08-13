const HELPER_TEXTAREA_SELECTOR = '.xterm-helper-textarea';
const COMPOSITION_VIEW_SELECTOR = '.composition-view';
const TERMINAL_SCREEN_SELECTOR = '.xterm-screen';

export interface TerminalCaretPosition {
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
}

interface CompositionAnchorPosition {
  left: string;
  top: string;
  width: string;
  height: string;
}

/** Keeps a Windows IME composition at the caret where the user started typing. */
export class TerminalCompositionAnchor {
  private position?: CompositionAnchorPosition;
  private readonly pendingRestores = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly host: HTMLElement,
    private readonly readCaret: () => TerminalCaretPosition,
  ) {}

  /** Gives Windows a valid caret rectangle before xterm starts a composition. */
  prepare(): void {
    const textarea = this.helperTextarea();
    if (!textarea) {
      return;
    }

    // xterm leaves this element at the previous composition's caret. Always refresh it here: a
    // newly focused terminal may have moved its prompt since the textarea was last used.
    const position = this.measureCaret();
    if (position) {
      this.applyToTextarea(textarea, position, true);
    }
  }

  /** Captures the caret once; terminal output must not move it during this composition. */
  begin(): void {
    this.cancelPendingRestores();
    this.position = this.measureCaret();
    this.restore();
  }

  /** Reapplies the captured position after xterm moves its composition elements on render. */
  restore(): void {
    if (!this.position) {
      return;
    }

    const textarea = this.helperTextarea();
    if (textarea) {
      this.applyToTextarea(textarea, this.position, false);
    }

    const compositionView = this.host.querySelector<HTMLElement>(COMPOSITION_VIEW_SELECTOR);
    if (compositionView) {
      compositionView.style.left = this.position.left;
      compositionView.style.top = this.position.top;
      compositionView.style.height = this.position.height;
      compositionView.style.lineHeight = this.position.height;
    }
  }

  /**
   * Restores now and once more after xterm's own deferred positioning pass.
   *
   * xterm calls `updateCompositionElements` synchronously on render/update and schedules the same
   * method with `setTimeout(0)`. Restoring only from our event or render listener therefore looks
   * correct for one task, then the deferred xterm pass moves the Windows IME back to the live
   * buffer cursor. Queueing after xterm keeps the focused terminal stable while other panes render.
   */
  restoreAfterBrowserUpdate(): void {
    this.restore();
    if (!this.position) {
      return;
    }

    const timer = setTimeout(() => {
      this.pendingRestores.delete(timer);
      this.restore();
    }, 0);
    this.pendingRestores.add(timer);
  }

  end(): void {
    this.position = undefined;
    this.cancelPendingRestores();
  }

  private measureCaret(): CompositionAnchorPosition | undefined {
    const screen = this.host.querySelector<HTMLElement>(TERMINAL_SCREEN_SELECTOR);
    if (!screen || screen.clientWidth <= 0 || screen.clientHeight <= 0) {
      return undefined;
    }

    const caret = this.readCaret();
    const cols = Math.max(caret.cols, 1);
    const rows = Math.max(caret.rows, 1);
    const cellWidth = screen.clientWidth / cols;
    const cellHeight = screen.clientHeight / rows;
    const cursorX = Math.min(Math.max(caret.cursorX, 0), cols - 1);
    const cursorY = Math.min(Math.max(caret.cursorY, 0), rows - 1);

    return {
      left: `${cursorX * cellWidth}px`,
      top: `${cursorY * cellHeight}px`,
      width: `${cellWidth}px`,
      height: `${cellHeight}px`,
    };
  }

  private helperTextarea(): HTMLTextAreaElement | null {
    return this.host.querySelector<HTMLTextAreaElement>(HELPER_TEXTAREA_SELECTOR);
  }

  private applyToTextarea(
    textarea: HTMLTextAreaElement,
    position: CompositionAnchorPosition,
    initializeWidth: boolean,
  ): void {
    textarea.style.left = position.left;
    textarea.style.top = position.top;
    textarea.style.height = position.height;
    textarea.style.lineHeight = position.height;
    if (initializeWidth) {
      textarea.style.width = position.width;
    }
  }

  private cancelPendingRestores(): void {
    for (const timer of this.pendingRestores) {
      clearTimeout(timer);
    }
    this.pendingRestores.clear();
  }
}
