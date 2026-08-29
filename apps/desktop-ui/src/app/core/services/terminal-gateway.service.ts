import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

import { TerminalPromptCapture } from '../models/prompt-assets';
import { TerminalSession } from '../models/workspace.models';
import { isTauriRuntime } from './tauri-runtime';

interface TerminalOutputEvent {
  terminalId: string;
  runtimeRevision: number;
  data: string;
}

/** Emitted once when a terminal's process ends, however it ended. */
export interface TerminalExitEvent {
  terminalId: string;
  runtimeRevision: number;
  exitCode: number;
  success: boolean;
}

/** Clears the current line and parks the cursor at its start, ready for a redraw. */
const ERASE_LINE = '\x1b[2K\r';

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
}

@Injectable({ providedIn: 'root' })
export class TerminalGatewayService {
  private readonly browserListeners = new Map<string, (data: string) => void>();
  private readonly browserInputs = new Map<string, TerminalPromptCapture>();

  async connect(
    terminalId: string,
    runtimeRevision: number,
    onOutput: (data: string) => void,
  ): Promise<UnlistenFn> {
    if (isTauriRuntime()) {
      return listen<TerminalOutputEvent>('terminal-output', (event) => {
        if (
          event.payload.terminalId === terminalId &&
          event.payload.runtimeRevision === runtimeRevision
        ) {
          onOutput(event.payload.data);
        }
      });
    }

    this.browserListeners.set(terminalId, onOutput);
    return () => {
      this.browserListeners.delete(terminalId);
      this.browserInputs.delete(terminalId);
    };
  }

  /**
   * Listens for terminals whose process ended.
   *
   * This is the only signal that a launch failed: a missing executable, a rejected key, or a CLI
   * that exits at once all leave a terminal that produced no output and never will.
   */
  async onExit(handler: (event: TerminalExitEvent) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) {
      // The emulated browser shell has no process to outlive.
      return () => {};
    }
    return listen<TerminalExitEvent>('terminal-exit', (event) => handler(event.payload));
  }

  async start(session: TerminalSession, cols: number, rows: number): Promise<void> {
    const request: TerminalStartRequest = {
      terminalId: session.id,
      runtimeRevision: session.runtimeRevision ?? 0,
      shell: session.shell,
      workingDirectory: session.workingDirectory,
      command: session.command,
      hideInitialCommand: session.agentType === 'codex' || session.agentType === 'opencode',
      cols,
      rows,
    };

    if (isTauriRuntime()) {
      await invoke('create_terminal', { request });
      return;
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
  }

  async write(session: TerminalSession, data: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('write_terminal', { terminalId: session.id, data });
      return;
    }

    this.handleBrowserInput(session, data);
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('resize_terminal', { terminalId, cols, rows });
    }
  }

  async close(terminalId: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('close_terminal', { terminalId });
    }
    this.browserListeners.delete(terminalId);
    this.browserInputs.delete(terminalId);
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
