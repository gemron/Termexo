/**
 * Chooses how a scroll reaches the program running inside the terminal.
 *
 * xterm gives one wheel event three different meanings depending on what is on the other end, and
 * a finger drag has to land on the same one the desktop wheel does. Deciding that here, rather
 * than synthesising a wheel and letting xterm route it, is what keeps a drag moving row for row:
 * xterm damps pixel deltas under 50px to 30% as a trackpad heuristic, and turns an event of any
 * size into a single arrow key for the alternate buffer. Both are right for a wheel notch and
 * leave a phone dragging four rows to move one.
 */

/** Mouse protocol names xterm reports through `Terminal.modes.mouseTrackingMode`. */
export type MouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any';

/** Which of xterm's buffers is in front, as `Terminal.buffer.active.type` reports it. */
export type TerminalBufferType = 'normal' | 'alternate';

/** How a scroll has to be delivered for the program in the terminal to act on it. */
export type TerminalScrollRoute =
  /** The program tracks the mouse and scrolls on wheel reports, as OpenCode does. */
  | 'mouseReport'
  /** A full-screen program on the alternate buffer, which reads the wheel as arrow keys. */
  | 'cursorKeys'
  /** An ordinary program, whose output xterm holds in a scrollback of its own. */
  | 'viewport';

/** x10 reports button presses only, so under it the wheel still belongs to the buffer. */
const WHEEL_REPORTING_MODES: readonly MouseTrackingMode[] = ['vt200', 'drag', 'any'];

export function terminalScrollRoute(
  mouseTrackingMode: MouseTrackingMode,
  bufferType: TerminalBufferType,
): TerminalScrollRoute {
  if (WHEEL_REPORTING_MODES.includes(mouseTrackingMode)) {
    return 'mouseReport';
  }
  return bufferType === 'alternate' ? 'cursorKeys' : 'viewport';
}

/** Cursor up and down in both forms, the application one selected by DECCKM. */
const CURSOR_KEYS = {
  normal: { up: '\x1b[A', down: '\x1b[B' },
  application: { up: '\x1bOA', down: '\x1bOB' },
} as const;

/**
 * The arrow keys that scroll a full-screen program by `rows`.
 *
 * Negative rows move towards older output, which is what the up arrow asks for. One key per row
 * keeps the transcript following the finger: the alternate buffer scrolls a line at a time, so
 * the count has to come from us — xterm sends a single key however far the wheel turned.
 */
export function cursorScrollSequence(rows: number, applicationCursorKeys: boolean): string {
  const keys = applicationCursorKeys ? CURSOR_KEYS.application : CURSOR_KEYS.normal;
  return (rows < 0 ? keys.up : keys.down).repeat(Math.abs(Math.trunc(rows)));
}

/** `WheelEvent.deltaMode` values, the three units the DOM measures a wheel in. */
const DELTA_MODE = { pixel: 0, line: 1, page: 2 } as const;

/** Rows one notch of a wheel scrolls: the Windows default, and what xterm's own scrollback moves. */
const ROWS_PER_WHEEL_NOTCH = 3;
/** Pixels a browser reports for one notch, already scaled by the system's own wheel setting. */
const PIXELS_PER_WHEEL_NOTCH = 100;
/** Lines a browser reports for one notch when it measures the wheel in lines, as Firefox does. */
const LINES_PER_WHEEL_NOTCH = 3;

/** The part of a wheel event that says how far it turned. */
export interface WheelDistance {
  readonly deltaY: number;
  readonly deltaMode: number;
}

/**
 * How many rows a wheel event should scroll, fractions included.
 *
 * xterm answers a wheel on the alternate buffer with a single arrow key however far the wheel
 * turned, so a full-screen agent crawled a line per notch while every other program moved three.
 * Measuring the distance here restores the notch, whichever unit the browser reports it in.
 */
export function wheelScrollRows(event: WheelDistance, terminalRows: number): number {
  switch (event.deltaMode) {
    case DELTA_MODE.line:
      return (event.deltaY / LINES_PER_WHEEL_NOTCH) * ROWS_PER_WHEEL_NOTCH;
    case DELTA_MODE.page:
      return event.deltaY * terminalRows;
    default:
      return (event.deltaY / PIXELS_PER_WHEEL_NOTCH) * ROWS_PER_WHEEL_NOTCH;
  }
}

/**
 * Adds up fractional rows and reports whole ones, keeping the remainder for the next call.
 *
 * Scrolling arrives in fractions of a row from every direction — a drag of a few pixels, a
 * trackpad's high-resolution wheel — and discarding what falls short of a row would leave the
 * smallest movements scrolling nothing at all, however long they continued.
 */
export class ScrollRowAccumulator {
  private carried = 0;

  take(rows: number): number {
    if (!Number.isFinite(rows)) {
      return 0;
    }
    this.carried += rows;
    const whole = Math.trunc(this.carried);
    this.carried -= whole;
    return whole;
  }

  reset(): void {
    this.carried = 0;
  }
}
