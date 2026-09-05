import { TestBed } from '@angular/core/testing';

import { TerminalSession } from '../models/workspace.models';
import { terminalEventMatchesSession, TerminalGatewayService } from './terminal-gateway.service';

describe('terminal runtime event matching', () => {
  it('accepts events from the active PTY revision', () => {
    expect(
      terminalEventMatchesSession(
        { terminalId: 'terminal-1', runtimeRevision: 2 },
        { id: 'terminal-1', runtimeRevision: 2 },
      ),
    ).toBe(true);
  });

  it('rejects delayed events from the PTY replaced during a model switch', () => {
    expect(
      terminalEventMatchesSession(
        { terminalId: 'terminal-1', runtimeRevision: 1 },
        { id: 'terminal-1', runtimeRevision: 2 },
      ),
    ).toBe(false);
  });

  it('treats a missing persisted revision as the initial PTY revision', () => {
    expect(
      terminalEventMatchesSession(
        { terminalId: 'terminal-1', runtimeRevision: 0 },
        { id: 'terminal-1' },
      ),
    ).toBe(true);
  });
});

describe('TerminalGatewayService attachment', () => {
  const runtime = globalThis as unknown as Record<string, unknown>;
  const CLEAR_SCREEN = '\u001b[2J\u001b[H';

  let commandHandler: (command: string, args: Record<string, unknown>) => Promise<unknown>;
  let eventHandlers: Map<string, (event: { event: string; payload: unknown }) => void>;
  let resolveScrollback: ((value: unknown) => void) | undefined;
  let service: TerminalGatewayService;

  function emitOutput(data: string, sequence: number, runtimeRevision = 3): void {
    eventHandlers.get('terminal-output')?.({
      event: 'terminal-output',
      payload: { terminalId: 'terminal-1', runtimeRevision, data, sequence },
    });
  }

  function pendingScrollback(): Promise<unknown> {
    return new Promise((resolve) => {
      resolveScrollback = resolve;
    });
  }

  beforeEach(() => {
    eventHandlers = new Map();
    resolveScrollback = undefined;
    commandHandler = (command) =>
      command === 'read_terminal_scrollback' ? pendingScrollback() : Promise.resolve(undefined);

    // Standing in for the desktop WebView bridge: the gateway must attach to a real backend
    // rather than fall back to the emulated browser shell.
    const callbacks = new Map<number, (event: { event: string; payload: unknown }) => void>();
    let nextCallbackId = 1;
    runtime['__TAURI_INTERNALS__'] = {
      transformCallback: (callback: (event: { event: string; payload: unknown }) => void) => {
        const id = nextCallbackId++;
        callbacks.set(id, callback);
        return id;
      },
      invoke: (command: string, args: Record<string, unknown>) => {
        if (command === 'plugin:event|listen') {
          const handler = callbacks.get(args['handler'] as number);
          if (handler) {
            eventHandlers.set(args['event'] as string, handler);
          }
          return Promise.resolve(nextCallbackId++);
        }
        return commandHandler(command, args);
      },
    };

    TestBed.configureTestingModule({});
    service = TestBed.inject(TerminalGatewayService);
  });

  afterEach(() => {
    delete runtime['__TAURI_INTERNALS__'];
  });

  it('writes the scrollback before the output that arrived while it was loading', async () => {
    const output: string[] = [];
    const connecting = service.connect('terminal-1', 3, (data) => output.push(data));
    await vi.waitFor(() => expect(resolveScrollback).toBeDefined());

    emitOutput('already-replayed', 7);
    emitOutput('fresh', 9);
    emitOutput('other-pty', 12, 2);
    expect(output).toEqual([]);

    resolveScrollback?.({ data: 'scrollback', sequence: 8, runtimeRevision: 3 });
    await connecting;

    // Everything up to sequence 8 is part of the snapshot; only newer output is written again.
    expect(output).toEqual(['scrollback', 'fresh']);
  });

  it('ignores a snapshot belonging to a PTY this view has already replaced', async () => {
    const output: string[] = [];
    const connecting = service.connect('terminal-1', 3, (data) => output.push(data));
    await vi.waitFor(() => expect(resolveScrollback).toBeDefined());

    resolveScrollback?.({ data: 'stale', sequence: 40, runtimeRevision: 2 });
    await connecting;
    emitOutput('live', 1);

    expect(output).toEqual(['live']);
  });

  it('clears the screen before replaying a reconnected terminal', async () => {
    const output: string[] = [];
    const connecting = service.connect('terminal-1', 3, (data) => output.push(data));
    await vi.waitFor(() => expect(resolveScrollback).toBeDefined());
    resolveScrollback?.({ data: 'scrollback', sequence: 8, runtimeRevision: 3 });
    await connecting;
    output.length = 0;
    commandHandler = () => Promise.resolve({ data: 'redrawn', sequence: 12, runtimeRevision: 3 });

    await service.replayAll();

    expect(output).toEqual([CLEAR_SCREEN, 'redrawn']);
  });

  const startableSession = () =>
    ({
      id: 'terminal-1',
      shell: 'powershell.exe',
      workingDirectory: 'D:\\dev\\termexo',
      runtimeRevision: 3,
      agentType: 'claude',
    }) as TerminalSession;

  it('reports whether the backend adopted a PTY that was already running', async () => {
    commandHandler = () => Promise.resolve({ attached: true, cols: 120, rows: 30 });

    await expect(service.start(startableSession(), 80, 24)).resolves.toEqual({
      attached: true,
      cols: 120,
      rows: 30,
    });
  });

  /**
   * Joining a running terminal means drawing the grid the agent already draws for, which the
   * joining window rarely matches — a phone attaching to a terminal the desktop sized, say.
   */
  it('reports the grid the running terminal uses rather than the size requested', async () => {
    commandHandler = () => Promise.resolve({ attached: true, cols: 130, rows: 44 });

    const result = await service.start(startableSession(), 47, 20);

    expect(result.cols).toBe(130);
    expect(result.rows).toBe(44);
  });

  /** A backend that reports no size leaves the caller with the one it asked for. */
  it('falls back to the requested size when the backend reports none', async () => {
    commandHandler = () => Promise.resolve({ attached: false });

    await expect(service.start(startableSession(), 80, 24)).resolves.toEqual({
      attached: false,
      cols: 80,
      rows: 24,
    });
  });
});
