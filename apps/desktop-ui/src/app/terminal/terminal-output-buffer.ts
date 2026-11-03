const MAX_BATCH_CHARACTERS = 128 * 1024;
const MAX_FRAME_WAIT_MS = 32;

interface OutputChunk {
  data: string;
  replayed: boolean;
}

/** Keeps one remote display update together without changing the terminal's byte stream. */
export class TerminalOutputBuffer {
  private chunks: OutputChunk[] = [];
  private characters = 0;
  private frame?: number;
  private deadline?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private readonly write: (data: string, replayed: boolean) => void) {}

  enqueue(data: string, replayed: boolean): void {
    if (this.disposed || !data) return;
    this.chunks.push({ data, replayed });
    this.characters += data.length;
    if (this.characters >= MAX_BATCH_CHARACTERS) {
      this.flush();
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
    this.chunks = [];
    this.characters = 0;
  }

  private flush(): void {
    this.cancelScheduledFlush();
    if (this.disposed || !this.chunks.length) return;
    const chunks = this.chunks;
    this.chunks = [];
    this.characters = 0;
    // Keep replay boundaries: only history is allowed to suppress xterm's generated replies.
    let index = 0;
    while (index < chunks.length && !this.disposed) {
      const replayed = chunks[index].replayed;
      const group: string[] = [];
      do {
        group.push(chunks[index++].data);
      } while (index < chunks.length && chunks[index].replayed === replayed);
      this.write(group.join(''), replayed);
    }
  }

  private cancelScheduledFlush(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    this.frame = undefined;
    this.deadline = undefined;
  }
}
