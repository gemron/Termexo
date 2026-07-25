import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

import { TerminalSession } from '../models/workspace.models';
import { isTauriRuntime } from './tauri-runtime';

interface TerminalOutputEvent {
  terminalId: string;
  data: string;
}

interface TerminalStartRequest {
  terminalId: string;
  shell: string;
  workingDirectory: string;
  command?: string;
  cols: number;
  rows: number;
}

@Injectable({ providedIn: 'root' })
export class TerminalGatewayService {
  private readonly browserListeners = new Map<string, (data: string) => void>();
  private readonly browserLines = new Map<string, string>();

  async connect(terminalId: string, onOutput: (data: string) => void): Promise<UnlistenFn> {
    if (isTauriRuntime()) {
      return listen<TerminalOutputEvent>('terminal-output', (event) => {
        if (event.payload.terminalId === terminalId) {
          onOutput(event.payload.data);
        }
      });
    }

    this.browserListeners.set(terminalId, onOutput);
    return () => {
      this.browserListeners.delete(terminalId);
      this.browserLines.delete(terminalId);
    };
  }

  async start(session: TerminalSession, cols: number, rows: number): Promise<void> {
    const request: TerminalStartRequest = {
      terminalId: session.id,
      shell: session.shell,
      workingDirectory: session.workingDirectory,
      command: session.command,
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
        '\u001b[38;2;88;199;160mAgentDock browser runtime\u001b[0m',
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
    this.browserLines.delete(terminalId);
  }

  private handleBrowserInput(session: TerminalSession, data: string): void {
    const currentLine = this.browserLines.get(session.id) ?? '';

    if (data === '\r') {
      this.emit(session.id, '\r\n');
      this.runBrowserCommand(session, currentLine.trim());
      this.browserLines.set(session.id, '');
      return;
    }

    if (data === '\u007f') {
      if (currentLine.length > 0) {
        this.browserLines.set(session.id, currentLine.slice(0, -1));
        this.emit(session.id, '\b \b');
      }
      return;
    }

    if (data >= ' ') {
      this.browserLines.set(session.id, currentLine + data);
      this.emit(session.id, data);
    }
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
