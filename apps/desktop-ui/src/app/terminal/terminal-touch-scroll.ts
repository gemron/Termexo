/**
 * Turns finger drags into terminal scrolling.
 *
 * xterm 6 draws the buffer to a canvas and moves its own synthetic scrollbar, so the viewport
 * holds no natively scrollable content for a touch gesture to act on. A wheel event reaches
 * xterm's handler and scrolls fine, but a drag produces none — which leaves a phone unable to read
 * anything above the last screenful. This converts the drag into the row counts xterm understands.
 */

/** Movement below this is a tap, not a scroll, so the terminal still takes focus normally. */
const SCROLL_INTENT_THRESHOLD_PX = 6;
/** Velocity samples older than this say nothing about the flick that just ended. */
const VELOCITY_WINDOW_MS = 120;
/** Per-frame velocity decay once the finger lifts, at the 60fps the animation assumes. */
const INERTIA_DECAY_PER_FRAME = 0.94;
/** Below this the glide is imperceptible, so it stops rather than creeping. */
const MIN_INERTIA_VELOCITY_PX_PER_MS = 0.015;
/** Guards against a flick launching a scroll that runs for seconds. */
const MAX_INERTIA_VELOCITY_PX_PER_MS = 4;
/** Reference frame duration, so decay stays consistent on displays faster than 60Hz. */
const REFERENCE_FRAME_MS = 1000 / 60;

interface VelocitySample {
  position: number;
  at: number;
}

/**
 * Accumulates drag distance and reports whole rows to scroll.
 *
 * Sub-row remainders are carried rather than dropped, so a slow drag still advances instead of
 * discarding every movement that falls short of one row.
 */
export class TerminalTouchScroller {
  private lastPosition = 0;
  private lastHorizontal = 0;
  private carriedPixels = 0;
  private travelledY = 0;
  private travelledX = 0;
  private scrolling = false;
  private declined = false;
  private samples: VelocitySample[] = [];

  /** Pixels per row, used to convert a drag into the row counts xterm scrolls by. */
  constructor(private readonly rowHeight: () => number) {}

  get active(): boolean {
    return this.scrolling;
  }

  begin(position: number, at: number, horizontalPosition = 0): void {
    this.lastPosition = position;
    this.lastHorizontal = horizontalPosition;
    this.carriedPixels = 0;
    this.travelledY = 0;
    this.travelledX = 0;
    this.scrolling = false;
    this.declined = false;
    this.samples = [{ position, at }];
  }

  /**
   * Reports how many rows the terminal should scroll for this movement.
   *
   * Negative moves towards older output, matching xterm's own sign convention, so dragging the
   * content downwards reveals what scrolled off the top.
   *
   * A gesture that turns out to be horizontal is declined for the rest of its life, leaving the
   * browser to pan a grid wider than the window — a remote client draws the desktop's grid, so
   * reaching the far side of it is the only way to read the whole line.
   */
  drag(position: number, at: number, horizontalPosition = this.lastHorizontal): number {
    const movement = position - this.lastPosition;
    const horizontalMovement = horizontalPosition - this.lastHorizontal;
    this.lastPosition = position;
    this.lastHorizontal = horizontalPosition;
    this.travelledY += Math.abs(movement);
    this.travelledX += Math.abs(horizontalMovement);
    this.recordSample(position, at);

    if (this.declined) {
      return 0;
    }
    // Until the finger has clearly travelled, the gesture may still turn out to be a tap.
    if (
      !this.scrolling &&
      Math.max(this.travelledY, this.travelledX) < SCROLL_INTENT_THRESHOLD_PX
    ) {
      return 0;
    }
    // The direction is settled once, at the moment the gesture stops being a tap: a drag that
    // wandered sideways mid-scroll should keep scrolling, not hand over to the browser.
    if (!this.scrolling && this.travelledX > this.travelledY) {
      this.declined = true;
      return 0;
    }
    this.scrolling = true;
    return this.toRows(movement);
  }

  /**
   * Velocity in pixels per millisecond at the moment the finger lifted, signed like `drag`.
   *
   * The carried remainder deliberately survives so the glide that follows continues from where
   * the finger left off instead of losing up to a row at the handover.
   */
  release(at: number): number {
    if (!this.scrolling) {
      return 0;
    }
    this.scrolling = false;
    this.recordSample(this.lastPosition, at);
    const oldest = this.samples[0];
    const newest = this.samples[this.samples.length - 1];
    const elapsed = newest.at - oldest.at;
    if (elapsed <= 0) {
      return 0;
    }
    const velocity = (newest.position - oldest.position) / elapsed;
    return clampVelocity(velocity);
  }

  cancel(): void {
    this.scrolling = false;
    this.carriedPixels = 0;
    this.samples = [];
  }

  /** Converts a glide step into rows, carrying the remainder like {@link drag} does. */
  glide(velocity: number, frameMs: number): number {
    return this.toRows(velocity * frameMs);
  }

  private toRows(pixels: number): number {
    const rowHeight = this.rowHeight();
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
      return 0;
    }
    this.carriedPixels += pixels;
    const rows = Math.trunc(this.carriedPixels / rowHeight);
    if (rows === 0) {
      return 0;
    }
    this.carriedPixels -= rows * rowHeight;
    // Dragging downwards should reveal older output, which xterm scrolls towards with negatives.
    return -rows;
  }

  private recordSample(position: number, at: number): void {
    this.samples.push({ position, at });
    while (this.samples.length > 2 && at - this.samples[0].at > VELOCITY_WINDOW_MS) {
      this.samples.shift();
    }
  }
}

function clampVelocity(velocity: number): number {
  const magnitude = Math.min(Math.abs(velocity), MAX_INERTIA_VELOCITY_PX_PER_MS);
  return magnitude < MIN_INERTIA_VELOCITY_PX_PER_MS ? 0 : Math.sign(velocity) * magnitude;
}

/** Decays a glide velocity by one frame, returning 0 once the movement stops being visible. */
export function decayInertia(velocity: number, frameMs: number): number {
  const frames = frameMs / REFERENCE_FRAME_MS;
  const decayed = velocity * INERTIA_DECAY_PER_FRAME ** frames;
  return Math.abs(decayed) < MIN_INERTIA_VELOCITY_PX_PER_MS ? 0 : decayed;
}
