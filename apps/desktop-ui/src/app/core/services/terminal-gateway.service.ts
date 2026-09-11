import { DestroyRef, inject, Injectable, NgZone } from '@angular/core';

import { TerminalPromptCapture } from '../models/prompt-assets';
import { TerminalSession } from '../models/workspace.models';
import { invoke, listen, UnlistenFn } from './backend-bridge';
import { RemoteConnectionService } from './remote-connection.service';
import { hasBackend, runtimeClientId } from './tauri-runtime';

interface TerminalOutputEvent {
  terminalId: string;
  runtimeRevision: number;
  data: string;
  /** Position in the terminal's output stream, used to drop what a replay already covered. */
  sequence?: number;
}

/** The size a terminal settled on, once every attached viewer's claim was considered. */
export interface TerminalResizedEvent {
  terminalId: string;
  cols: number;
  rows: number;
}

/** Emitted once when a terminal's process ends, however it ended. */
export interface TerminalExitEvent {
  terminalId: string;
  runtimeRevision: number;
  exitCode: number;
  success: boolean;
}

/** What `create_terminal` reports back: whether it adopted a PTY that was already running. */
export interface TerminalStartResult {
  attached: boolean;
  /** The grid the PTY is running at, which a joining client must draw rather than its own fit. */
  cols: number;
  rows: number;
}

/** The output a terminal has produced so far, plus the point that snapshot reaches. */
interface TerminalScrollback {
  /**
   * A redraw of the terminal's screen, not the output that drew it.
   *
   * The backend parses the PTY's output into a screen of its own and describes that screen here,
   * so what arrives stands on its own: it starts from no assumed cursor, attributes or mode, and
   * it is laid out for the grid the PTY is running at. Which is why the caller has to settle the
   * emulator's grid before asking for it.
   */
  data: string;
  sequence: number;
  runtimeRevision: number;
}

/** Clears the current line and parks the cursor at its start, ready for a redraw. */
const ERASE_LINE = '\x1b[2K\r';
/**
 * Wipes the screen and the scrollback above it, so a replay does not stack on what it replaces.
 *
 * A snapshot carries the lines that scrolled off as well as the visible grid, so clearing only
 * what is on screen would leave the previous replay's copy of that history standing above the
 * new one, and every resync would add another.
 */
const CLEAR_SCREEN = '\x1b[H\x1b[2J\x1b[3J';

const TERMINAL_OUTPUT_EVENT = 'terminal-output';
const TERMINAL_EXIT_EVENT = 'terminal-exit';
const TERMINAL_RESIZED_EVENT = 'terminal-resized';
/** Raised by the remote bridge when the server had to drop frames for this connection. */
const RESYNC_EVENT = 'resync';

/** A terminal the backend still has a process for. */
interface LiveTerminal {
  terminalId: string;
  runtimeRevision: number;
}

type TerminalRuntimeEvent = Pick<TerminalExitEvent, 'terminalId' | 'runtimeRevision'>;

/** Prevents delayed events from a replaced PTY from affecting its successor with the same id. */
export function terminalEventMatchesSession(
  event: TerminalRuntimeEvent,
  session: Pick<TerminalSession, 'id' | 'runtimeRevision'>,
): boolean {
  return (
    event.terminalId === session.id && event.runtimeRevision === (session.runtimeRevision ?? 0)
  );
}

interface TerminalStartRequest {
  terminalId: string;
  runtimeRevision: number;
  shell: string;
  workingDirectory: string;
  command?: string;
  hideInitialCommand?: boolean;
  cols: number;
  rows: number;
  /** Which client these dimensions describe, so several viewers can share one PTY. */
  viewerId: string;
  agentType?: string;
  accountProfileId?: string;
  profileId?: string;
  workspaceId?: string;
}

/** One attached terminal view and how far through the output stream it has been fed. */
interface TerminalConnection {
  id: string;
  runtimeRevision: number;
  /** `replayed` marks history being redrawn, which must not be analysed a second time. */
  onOutput: (data: string, replayed: boolean) => void;
  /** Live output that arrived while a replay was in flight, held back to keep the order right. */
  buffered: TerminalOutputEvent[];
  replaying: boolean;
  lastSequence: number;
  /** The redraw this terminal is already doing, so a second signal joins it rather than repeating it. */
  replayInFlight?: Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class TerminalGatewayService {
  private readonly remoteConnection = inject(RemoteConnectionService);
  private readonly zone = inject(NgZone);
  private readonly connections = new Map<string, TerminalConnection>();
  private readonly browserListeners = new Map<string, (data: string) => void>();
  private readonly browserInputs = new Map<string, TerminalPromptCapture>();
  /** The one output subscription every terminal is dispatched from. */
  private outputListener?: Promise<UnlistenFn>;
  /** The redraw pass currently running, and whether a signal arrived while it ran. */
  private replayAllInFlight?: Promise<void>;
  private replayAllPending = false;
  private uiSyncHandle?: number;

  constructor() {
    if (hasBackend()) {
      void this.watchReplaySignals();
    }
    inject(DestroyRef).onDestroy(() => {
      if (this.uiSyncHandle !== undefined) {
        cancelAnimationFrame(this.uiSyncHandle);
      }
      // Nothing depends on the unsubscribe succeeding — the app is going away with it.
      void this.outputListener?.then((unlisten) => unlisten()).catch(() => undefined);
    });
  }

  /**
   * Subscribes a terminal view to a PTY that may already be running.
   *
   * The subscription is installed before the scrollback is read so nothing produced in between is
   * lost: output that arrives from here on waits in a buffer until {@link replayInitial} has
   * written the history, and whatever the snapshot already covered is then dropped by sequence
   * number. The history is deliberately not written yet — the emulator is still at the size this
   * client guessed for itself, and parsing an agent's frames at the wrong width wraps them where
   * the agent never did. The caller settles the grid first and then asks for the replay.
   */
  async connect(
    terminalId: string,
    runtimeRevision: number,
    onOutput: (data: string, replayed: boolean) => void,
  ): Promise<UnlistenFn> {
    if (!hasBackend()) {
      this.browserListeners.set(terminalId, (data) => onOutput(data, false));
      return () => {
        this.browserListeners.delete(terminalId);
        this.browserInputs.delete(terminalId);
      };
    }

    const connection: TerminalConnection = {
      id: terminalId,
      runtimeRevision,
      onOutput,
      buffered: [],
      replaying: true,
      lastSequence: 0,
    };
    this.connections.set(terminalId, connection);

    await this.ensureOutputListener();

    return () => {
      if (this.connections.get(terminalId) === connection) {
        this.connections.delete(terminalId);
      }
    };
  }

  /**
   * Writes the history a terminal missed, once its grid matches the PTY's.
   *
   * Must be called for every {@link connect}, including when the launch it was waiting on failed:
   * the buffer that {@link connect} started filling is only released here, and output held in it
   * would otherwise never reach the screen.
   */
  async replayInitial(terminalId: string): Promise<void> {
    const connection = this.connections.get(terminalId);
    if (connection) {
      await this.replay(connection, false);
    }
  }

  /**
   * Draws one terminal again from the backend's screen, replacing what it is showing.
   *
   * A grid change is not something an emulator can absorb on its own. What is on screen was drawn
   * for the old width by a program that positions itself in columns, and rewrapping those frames
   * produces something the program never drew — the agent then redraws its live region over the
   * misplaced remains. The backend re-lays its own screen out whenever the PTY's grid moves, so
   * asking it again is the only thing that puts the two back in step.
   */
  async redraw(terminalId: string): Promise<void> {
    const connection = this.connections.get(terminalId);
    if (connection) {
      await this.replay(connection, true);
    }
  }

  /**
   * Subscribes to the output stream once for the whole app, rather than once per terminal.
   *
   * The backend raises one event per PTY read for every terminal, so a listener per terminal made
   * each event wake every open terminal and deserialise its payload again — quadratic in the number
   * of terminals, and the reason typing stuttered while an agent was producing output. The single
   * listener dispatches by id instead.
   *
   * It stays registered for the life of the app: terminals come and go through `connections`, and
   * re-registering on the last disconnect would only trade this cost for a reconnect race.
   */
  private async ensureOutputListener(): Promise<void> {
    // Outside Angular: an agent writing output would otherwise run change detection over the whole
    // workbench for every chunk it produces. What the output does move on screen is flushed once a
    // frame by `scheduleUiSync`.
    this.outputListener ??= this.zone.runOutsideAngular(() =>
      listen<TerminalOutputEvent>(TERMINAL_OUTPUT_EVENT, (event) =>
        this.handleOutput(event.payload),
      ),
    );
    await this.outputListener;
  }

  /**
   * Runs one change detection per frame, however many output chunks arrived in it.
   *
   * Terminal state, task progress and the attention banner all follow the output stream, and they
   * are read from signals written outside the zone. Coalescing per frame keeps them live without
   * paying a full pass per chunk.
   */
  private scheduleUiSync(): void {
    if (this.uiSyncHandle !== undefined) {
      return;
    }
    this.uiSyncHandle = requestAnimationFrame(() => {
      this.uiSyncHandle = undefined;
      this.zone.run(() => undefined);
    });
  }

  /**
   * Listens for terminals whose process ended.
   *
   * This is the only signal that a launch failed: a missing executable, a rejected key, or a CLI
   * that exits at once all leave a terminal that produced no output and never will.
   */
  async onExit(handler: (event: TerminalExitEvent) => void): Promise<UnlistenFn> {
    if (!hasBackend()) {
      // The emulated browser shell has no process to outlive.
      return () => undefined;
    }
    return listen<TerminalExitEvent>(TERMINAL_EXIT_EVENT, (event) => handler(event.payload));
  }

  /**
   * Listens for the size a terminal settled on once every viewer's claim was considered.
   *
   * The emulator has to follow this rather than its own fit: the PTY is shared, so it is only ever
   * as wide as the narrowest client watching.
   */
  async onResized(handler: (event: TerminalResizedEvent) => void): Promise<UnlistenFn> {
    if (!hasBackend()) {
      return () => undefined;
    }
    return listen<TerminalResizedEvent>(TERMINAL_RESIZED_EVENT, (event) => handler(event.payload));
  }

  async start(
    session: TerminalSession,
    cols: number,
    rows: number,
    workspaceId?: string,
  ): Promise<TerminalStartResult> {
    const request: TerminalStartRequest = {
      terminalId: session.id,
      runtimeRevision: session.runtimeRevision ?? 0,
      shell: session.shell,
      workingDirectory: session.workingDirectory,
      command: session.command,
      hideInitialCommand: session.agentType === 'codex' || session.agentType === 'opencode',
      cols,
      rows,
      viewerId: runtimeClientId(),
      // Carried so a reconnecting terminal can rebuild the launch environment, which the backend
      // hands out once and loses on restart. Without them it would start as the default account.
      agentType: session.agentType,
      accountProfileId: session.accountProfileId,
      profileId: session.profileId,
      workspaceId,
    };

    if (hasBackend()) {
      const result = await invoke<TerminalStartResult>('create_terminal', { request });
      return {
        attached: result?.attached === true,
        cols: result?.cols || cols,
        rows: result?.rows || rows,
      };
    }

    const prompt = this.browserPrompt(session);
    this.emit(
      session.id,
      [
        '\u001b[38;2;88;199;160mTermexo browser runtime\u001b[0m',
        `Workspace: ${session.workingDirectory}`,
        `Agent: ${session.name}  Model: ${session.model}`,
        'Install Rust and run `npm run tauri:dev` for a real PTY.',
        '',
        prompt,
      ].join('\r\n'),
    );
    return { attached: false, cols, rows };
  }

  async write(session: TerminalSession, data: string): Promise<void> {
    if (hasBackend()) {
      await invoke('write_terminal', { terminalId: session.id, data });
      return;
    }

    this.handleBrowserInput(session, data);
  }

  /**
   * Reports what this window can display.
   *
   * The agent draws for one grid, so the terminal's size belongs to whichever view the user is
   * working in: `claim` marks that view and hands it the terminal. A report without it only counts
   * when this client already owns the terminal, which is how a background window relaying out
   * itself leaves the one in use alone.
   */
  async resize(terminalId: string, cols: number, rows: number, claim = false): Promise<void> {
    if (hasBackend()) {
      await invoke('resize_terminal', {
        terminalId,
        viewerId: runtimeClientId(),
        cols,
        rows,
        claim,
      });
    }
  }

  /**
   * The terminals whose process is still running, mapped to the launch that is running.
   *
   * Loading is not the same as starting: a reloaded window and a second client both arrive at a
   * backend whose terminals are still working, and relaunching those would kill the agents in
   * them. Empty without a backend, where nothing is running to begin with.
   */
  async liveTerminals(): Promise<Map<string, number>> {
    if (!hasBackend()) {
      return new Map();
    }
    try {
      const live = await invoke<LiveTerminal[]>('list_live_terminals');
      return new Map(live.map((terminal) => [terminal.terminalId, terminal.runtimeRevision]));
    } catch (error) {
      // Treated as nothing running, which restores terminals the way every release before this
      // one did rather than leaving the workbench with terminals it refuses to start.
      console.warn('Unable to read the running terminals.', error);
      return new Map();
    }
  }

  /** Opens an address a terminal printed, in the default browser on the machine running the PTY. */
  async openUrl(url: string): Promise<void> {
    await invoke('open_terminal_url', { url });
  }

  /**
   * Opens a file or folder a terminal printed.
   *
   * The working directory travels with it because most of what an agent prints is relative to
   * where it was standing, and only the backend knows whether the result is really there.
   */
  async openPath(path: string, workingDirectory?: string): Promise<void> {
    await invoke('open_terminal_path', { path, workingDirectory });
  }

  async close(terminalId: string, preserveRepositoryBaseline = false): Promise<void> {
    if (hasBackend()) {
      await invoke('close_terminal', { terminalId, preserveRepositoryBaseline });
    }
    this.connections.delete(terminalId);
    this.browserListeners.delete(terminalId);
    this.browserInputs.delete(terminalId);
  }

  /**
   * Redraws every attached terminal, coalescing the signals that arrive while one redraw runs.
   *
   * Resyncs come in bursts: the server raises one per gap it had to leave, and a client that is
   * still settling after a reload leaves several. Letting each one start its own pass asked the
   * backend for the same snapshot repeatedly and wrote every answer to the same terminal, which
   * drew the screen twice over and released the buffered live output alongside each copy.
   *
   * The compounding part is worse than the duplication. Every extra copy is work the UI thread
   * must finish before it can read the socket again, and falling behind the socket is exactly what
   * raises the next resync — the signal and its own remedy feed each other until the window stops
   * responding. One pass at a time, with a later signal folded into a single follow-up, is what
   * breaks that loop.
   */
  async replayAll(): Promise<void> {
    if (this.replayAllInFlight) {
      this.replayAllPending = true;
      return this.replayAllInFlight;
    }
    this.replayAllInFlight = Promise.all(
      [...this.connections.values()].map((connection) => this.replay(connection, true)),
    ).then(() => undefined);
    try {
      await this.replayAllInFlight;
    } finally {
      this.replayAllInFlight = undefined;
    }
    if (this.replayAllPending) {
      this.replayAllPending = false;
      await this.replayAll();
    }
  }

  /** Replays after the output stream was interrupted, whichever way it was interrupted. */
  private async watchReplaySignals(): Promise<void> {
    this.remoteConnection.onReconnected(() => void this.replayAll());
    await listen(RESYNC_EVENT, () => void this.replayAll());
  }

  private handleOutput(payload: TerminalOutputEvent): void {
    const connection = this.connections.get(payload.terminalId);
    if (!connection || !terminalEventMatchesSession(payload, connection)) {
      return;
    }
    if (connection.replaying) {
      connection.buffered.push(payload);
      return;
    }
    this.deliver(connection, payload);
  }

  private deliver(connection: TerminalConnection, payload: TerminalOutputEvent): void {
    const sequence = payload.sequence ?? 0;
    if (sequence > 0) {
      if (sequence <= connection.lastSequence) {
        // Already covered by the replayed scrollback.
        return;
      }
      connection.lastSequence = sequence;
    }
    connection.onOutput(payload.data, false);
    this.scheduleUiSync();
  }

  /**
   * Redraws one terminal, joining the redraw already running rather than starting a second.
   *
   * `replayInitial` and a resync can reach the same terminal at once, and two passes over one
   * connection corrupt it rather than merely repeating work: each releases `buffered` when it
   * finishes, so live output held for the first pass is delivered in the middle of the second
   * one's history, and each writes its own `lastSequence`, which decides what is dropped as
   * already-seen.
   */
  private replay(connection: TerminalConnection, clearScreen: boolean): Promise<void> {
    connection.replayInFlight ??= this.replayOnce(connection, clearScreen).finally(() => {
      connection.replayInFlight = undefined;
    });
    return connection.replayInFlight;
  }

  private async replayOnce(connection: TerminalConnection, clearScreen: boolean): Promise<void> {
    connection.replaying = true;
    try {
      const scrollback = await invoke<TerminalScrollback>('read_terminal_scrollback', {
        terminalId: connection.id,
      });
      // A snapshot from a PTY this view has already replaced would draw someone else's output.
      if (scrollback.runtimeRevision === connection.runtimeRevision && scrollback.data) {
        if (clearScreen) {
          connection.onOutput(CLEAR_SCREEN, true);
        }
        connection.onOutput(scrollback.data, true);
        connection.lastSequence = scrollback.sequence;
      }
    } catch (error) {
      console.warn('Unable to replay terminal scrollback.', error);
    } finally {
      connection.replaying = false;
      for (const payload of connection.buffered.splice(0)) {
        this.deliver(connection, payload);
      }
      this.scheduleUiSync();
    }
  }

  /**
   * Mirrors how an agent CLI reads its input, so the preview shows what the desktop app really
   * writes: control keys, bracketed pastes and the Enter that submits them all arrive separately.
   */
  private handleBrowserInput(session: TerminalSession, data: string): void {
    const capture = this.browserInputFor(session.id);
    const result = capture.consume(data);
    if (result.submitted.length === 0) {
      this.emit(session.id, `${ERASE_LINE}${this.browserPrompt(session)}${result.draft}`);
      return;
    }
    for (const command of result.submitted) {
      this.emit(session.id, '\r\n');
      this.runBrowserCommand(session, command);
    }
  }

  private browserInputFor(terminalId: string): TerminalPromptCapture {
    let capture = this.browserInputs.get(terminalId);
    if (!capture) {
      capture = new TerminalPromptCapture();
      this.browserInputs.set(terminalId, capture);
    }
    return capture;
  }

  private runBrowserCommand(session: TerminalSession, command: string): void {
    const prompt = this.browserPrompt(session);
    const responses: Record<string, string> = {
      help: 'Commands: help, status, git status, clear',
      status: `${session.name}: ${session.status} · ${session.model}`,
      'git status': `On branch ${session.branch}\r\nworking tree clean`,
    };

    if (command === 'clear') {
      this.emit(session.id, '\u001bc' + prompt);
      return;
    }

    const response = command
      ? (responses[command.toLowerCase()] ?? `Command preview: ${command}`)
      : '';
    this.emit(session.id, `${response}${response ? '\r\n' : ''}${prompt}`);
  }

  private browserPrompt(session: TerminalSession): string {
    return `\u001b[38;2;104;169;232m${session.agentType}\u001b[0m \u001b[38;2;150;157;164m${session.branch}\u001b[0m > `;
  }

  private emit(terminalId: string, data: string): void {
    this.browserListeners.get(terminalId)?.(data);
  }
}
