export interface TerminalDimensions {
  cols: number;
  rows: number;
}

const sameDimensions = (left: TerminalDimensions | undefined, right: TerminalDimensions): boolean =>
  left?.cols === right.cols && left.rows === right.rows;

export class TerminalResizeCoordinator {
  private timerId?: ReturnType<typeof setTimeout>;
  private pending?: TerminalDimensions;
  private lastApplied?: TerminalDimensions;
  private applying = false;
  private disposed = false;

  constructor(
    private readonly applyResize: (dimensions: TerminalDimensions) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly debounceMs = 80,
  ) {}

  schedule(dimensions: TerminalDimensions): void {
    if (this.disposed || dimensions.cols <= 0 || dimensions.rows <= 0) {
      return;
    }
    if (sameDimensions(this.pending, dimensions)) {
      return;
    }
    if (
      !this.applying &&
      this.timerId === undefined &&
      sameDimensions(this.lastApplied, dimensions)
    ) {
      return;
    }

    this.pending = dimensions;
    if (this.timerId !== undefined) {
      clearTimeout(this.timerId);
    }
    this.timerId = setTimeout(() => {
      this.timerId = undefined;
      void this.flush();
    }, this.debounceMs);
  }

  dispose(): void {
    this.disposed = true;
    this.pending = undefined;
    if (this.timerId !== undefined) {
      clearTimeout(this.timerId);
      this.timerId = undefined;
    }
  }

  private async flush(): Promise<void> {
    if (this.applying || this.disposed) {
      return;
    }

    this.applying = true;
    try {
      while (!this.disposed && this.pending) {
        const dimensions = this.pending;
        this.pending = undefined;
        if (sameDimensions(this.lastApplied, dimensions)) {
          continue;
        }
        try {
          await this.applyResize(dimensions);
          this.lastApplied = dimensions;
        } catch (error) {
          this.onError(error);
        }
      }
    } finally {
      this.applying = false;
    }
  }
}
