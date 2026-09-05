import { inject, Injectable } from '@angular/core';

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
  data: string;
  sequence: number;
  runtimeRevision: number;
}

/** Clears the current line and parks the cursor at its start, ready for a redraw. */
const ERASE_LINE = '\x1b[2K\r';
/** Wipes the screen and homes the cursor, so a replay does not stack on top of stale output. */
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

const TERMINAL_OUTPUT_EVENT = 'terminal-output';
const TERMINAL_EXIT_EVENT = 'terminal-exit';
const TERMINAL_RESIZED_EVENT = 'terminal-resized';
/** Raised by the remote bridge when the server had to drop frames for this connection. */
const RESYNC_EVENT = 'resync';

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
  onOutput: (data: string) => void;
  /** Live output that arrived while a replay was in flight, held back to keep the order right. */
  buffered: TerminalOutputEvent[];
  replaying: boolean;
  lastSequence: number;
}

@Injectable({ providedIn: 'root' })
export class TerminalGatewayService {
  private readonly remoteConnection = inject(RemoteConnectionService);
  private readonly connections = new Map<string, TerminalConnection>();
  private readonly browserListeners = new Map<string, (data: string) => void>();
  private readonly browserInputs = new Map<string, TerminalPromptCapture>();

  constructor() {
    if (hasBackend()) {
      void this.watchReplaySignals();
    }
  }

  /**
   * Attaches a terminal view to a PTY that may already be running.
   *
   * The subscription is installed before the scrollback is read so nothing produced in between is
   * lost; those events wait in a buffer and are released once the replay has been written, with
   * anything the snapshot already contained dropped by sequence number.
   */
  async connect(
    terminalId: string,
    runtimeRevision: number,
    onOutput: (data: string) => void,
  ): Promise<UnlistenFn> {
    if (!hasBackend()) {
      this.browserListeners.set(terminalId, onOutput);
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

    const unlisten = await listen<TerminalOutputEvent>(TERMINAL_OUTPUT_EVENT, (event) =>
      this.handleOutput(connection, event.payload),
    );
    await this.replay(connection, false);

    return () => {
      unlisten();
      if (this.connections.get(terminalId) === connection) {
        this.connections.delete(terminalId);
      }
    };
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

  async close(terminalId: string, preserveRepositoryBaseline = false): Promise<void> {
    if (hasBackend()) {
      await invoke('close_terminal', { terminalId, preserveRepositoryBaseline });
    }
    this.connections.delete(terminalId);
    this.browserListeners.delete(terminalId);
    this.browserInputs.delete(terminalId);
  }

  /** Redraws every attached terminal from the backend's replay buffer. */
  async replayAll(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map((connection) => this.replay(connection, true)),
    );
  }

  /** Replays after the output stream was interrupted, whichever way it was interrupted. */
  private async watchReplaySignals(): Promise<void> {
    this.remoteConnection.onReconnected(() => void this.replayAll());
    await listen(RESYNC_EVENT, () => void this.replayAll());
  }

  private handleOutput(connection: TerminalConnection, payload: TerminalOutputEvent): void {
    if (!terminalEventMatchesSession(payload, connection)) {
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
    connection.onOutput(payload.data);
  }

  private async replay(connection: TerminalConnection, clearScreen: boolean): Promise<void> {
    connection.replaying = true;
    try {
      const scrollback = await invoke<TerminalScrollback>('read_terminal_scrollback', {
        terminalId: connection.id,
      });
      // A snapshot from a PTY this view has already replaced would draw someone else's output.
      if (scrollback.runtimeRevision === connection.runtimeRevision && scrollback.data) {
        if (clearScreen) {
          connection.onOutput(CLEAR_SCREEN);
        }
        connection.onOutput(scrollback.data);
        connection.lastSequence = scrollback.sequence;
      }
    } catch (error) {
      console.warn('Unable to replay terminal scrollback.', error);
    } finally {
      connection.replaying = false;
      for (const payload of connection.buffered.splice(0)) {
        this.deliver(connection, payload);
      }
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
