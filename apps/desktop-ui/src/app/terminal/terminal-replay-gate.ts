/**
 * Tracks whether the terminal is redrawing history, during which its own answers must be held back.
 *
 * xterm answers what the stream asks of it: a device attributes request is replied to with
 * `\x1b[?1;2c`, a cursor position request with the cursor's position. Those answers leave as
 * terminal input, and the program on the other end receives an answer to a question it never
 * asked this time — a shell treats it as typed text and prints `[?1;2c` at its prompt.
 *
 * A replay is the one stream xterm parses that no program asked for, so it is the one stream whose
 * answers are never wanted. The backend's snapshot is built from a parsed screen and carries no
 * queries of its own today; this keeps that a property of the replay path rather than of whatever
 * happens to be in the snapshot.
 *
 * Counted rather than flagged, because a resync can begin a second replay before the first has
 * finished parsing.
 */
export class TerminalReplayGate {
  private inFlight = 0;

  /** True while any replay is still being parsed, and so while answers must not be sent. */
  get replaying(): boolean {
    return this.inFlight > 0;
  }

  begin(): void {
    this.inFlight++;
  }

  end(): void {
    // xterm calls a write callback once per write, but a terminal torn down mid-parse may never
    // call it at all; clamping keeps a stray end from unbalancing a replay that is still running.
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
}
