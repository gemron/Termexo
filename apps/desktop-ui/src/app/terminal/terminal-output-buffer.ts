const MAX_BATCH_CHARACTERS = 128 * 1024;
const MAX_FRAME_WAIT_MS = 32;
const MAX_REDRAW_WAIT_MS = 200;
const CLEAR_DISPLAY = '\x1b[2J';
const CLEAR_DISPLAY_C1 = '\x9b2J';
const NON_DRAWING_OUTPUT = /(?:\x1b\[|\x9b)[0-9:;]*[A-HJKSTdfm]|(?:\x1b\[|\x9b)\?25[hl]|[\b\t\n\r]/g;
const PARTIAL_CSI = /(?:\x1b(?:\[[0-9:;?]*)?|\x9b[0-9:;?]*)$/;

interface OutputBatch {
  chunks: string[];
  replayed: boolean;
}

/** Keeps one remote display update together without changing the terminal's byte stream. */
export class TerminalOutputBuffer {
  private batches: OutputBatch[] = [];
  private characters = 0;
  private frame?: number;
  private deadline?: ReturnType<typeof setTimeout>;
  private redrawDeadline?: ReturnType<typeof setTimeout>;
  private liveTail = '';
  private disposed = false;

  constructor(private readonly write: (data: string, replayed: boolean) => void) {}

  enqueue(data: string, replayed: boolean): void {
    if (this.disposed || !data) return;
    // Only history is allowed to suppress xterm's generated replies.
    const batch = this.batches.at(-1);
    if (batch?.replayed === replayed) batch.chunks.push(data);
    else this.batches.push({ chunks: [data], replayed });
    this.characters += data.length;
    if (this.characters >= MAX_BATCH_CHARACTERS) {
      this.flush(false);
      return;
    }
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => this.flush());
    // Hidden pages throttle animation frames. Parsing must still keep up with the stream.
    this.deadline = setTimeout(() => this.flush(), MAX_FRAME_WAIT_MS);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelScheduledFlush();
    clearTimeout(this.redrawDeadline);
    this.batches = [];
    this.characters = 0;
  }

  private flush(waitForRedraw = true): void {
    this.cancelScheduledFlush();
    const [firstBatch, ...followingBatches] = this.batches;
    if (this.disposed || !firstBatch) return;
    const data = firstBatch.chunks.join('');
    if (
      waitForRedraw &&
      !firstBatch.replayed &&
      !followingBatches.length &&
      this.endsWithUnpaintedClear(data)
    ) {
      // A program can send the erase and the replacement screen in different remote frames.
      // Keep the old screen visible briefly, even if more cursor or colour commands arrive.
      this.redrawDeadline ??= setTimeout(() => this.flush(false), MAX_REDRAW_WAIT_MS);
      return;
    }
    clearTimeout(this.redrawDeadline);
    this.redrawDeadline = undefined;
    this.batches = [];
    this.characters = 0;
    this.writeBatch(data, firstBatch.replayed);
    for (const batch of followingBatches) {
      if (this.disposed) break;
      this.writeBatch(batch.chunks.join(''), batch.replayed);
    }
  }

  private endsWithUnpaintedClear(data: string): boolean {
    // Look behind just far enough to recognise a clear split across two writes.
    const output = this.liveTail + data;
    const clear = output.lastIndexOf(CLEAR_DISPLAY);
    const c1Clear = output.lastIndexOf(CLEAR_DISPLAY_C1);
    const clearEnd = Math.max(
      clear < 0 ? 0 : clear + CLEAR_DISPLAY.length,
      c1Clear < 0 ? 0 : c1Clear + CLEAR_DISPLAY_C1.length,
    );
    return (
      clearEnd > this.liveTail.length &&
      output.slice(clearEnd).replace(NON_DRAWING_OUTPUT, '').replace(PARTIAL_CSI, '') === ''
    );
  }

  private writeBatch(data: string, replayed: boolean): void {
    this.liveTail = replayed ? '' : (this.liveTail + data).slice(-(CLEAR_DISPLAY.length - 1));
    this.write(data, replayed);
  }

  private cancelScheduledFlush(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    this.frame = undefined;
    this.deadline = undefined;
  }
}
