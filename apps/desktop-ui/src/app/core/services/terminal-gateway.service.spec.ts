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
  // Clears the scrollback too, so a resync's replayed history replaces the last one rather
  // than stacking on top of it.
  const CLEAR_SCREEN = '\u001b[H\u001b[2J\u001b[3J';

  let commandHandler: (command: string, args: Record<string, unknown>) => Promise<unknown>;
  let eventHandlers: Map<string, (event: { event: string; payload: unknown }) => void>;
  let resolveScrollback: ((value: unknown) => void) | undefined;
  let outputListenCount: number;
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
    outputListenCount = 0;
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
          if (args['event'] === 'terminal-output') {
            outputListenCount += 1;
          }
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
    await service.connect('terminal-1', 3, (data) => output.push(data));

    // The window this ordering has to survive: subscribed, but the grid the history will be
    // parsed at is still being negotiated, so nothing has been written to the emulator yet.
    emitOutput('already-replayed', 7);
    emitOutput('fresh', 9);
    emitOutput('other-pty', 12, 2);
    expect(output).toEqual([]);

    const replaying = service.replayInitial('terminal-1');
    await vi.waitFor(() => expect(resolveScrollback).toBeDefined());
    resolveScrollback?.({ data: 'scrollback', sequence: 8, runtimeRevision: 3 });
    await replaying;

    // Everything up to sequence 8 is part of the snapshot; only newer output is written again.
    expect(output).toEqual(['scrollback', 'fresh']);
  });

  it('subscribes to the output stream once however many terminals attach', async () => {
    // One subscription per terminal made every chunk wake every terminal and deserialise its
    // payload again, which is what stalled typing while an agent was producing output.
    commandHandler = () => Promise.resolve({ data: '', sequence: 0, runtimeRevision: 3 });

    await service.connect('terminal-1', 3, () => undefined);
    await service.connect('terminal-2', 3, () => undefined);
    await service.connect('terminal-3', 3, () => undefined);

    expect(outputListenCount).toBe(1);
  });

  it('marks replayed history so the output readers skip it', async () => {
    const writes: Array<{ data: string; replayed: boolean }> = [];
    await service.connect('terminal-1', 3, (data, replayed) => writes.push({ data, replayed }));

    const replaying = service.replayInitial('terminal-1');
    await vi.waitFor(() => expect(resolveScrollback).toBeDefined());
    resolveScrollback?.({ data: 'history', sequence: 8, runtimeRevision: 3 });
    await replaying;
    emitOutput('live', 9);

    expect(writes).toEqual([
      { data: 'history', replayed: true },
      { data: 'live', replayed: false },
    ]);
  });

  it('ignores a snapshot belonging to a PTY this view has already replaced', async () => {
    const output: string[] = [];
    await service.connect('terminal-1', 3, (data) => output.push(data));

    const replaying = service.replayInitial('terminal-1');
    await vi.waitFor(() => expect(resolveScrollback).toBeDefined());
    resolveScrollback?.({ data: 'stale', sequence: 40, runtimeRevision: 2 });
    await replaying;
    emitOutput('live', 1);

    expect(output).toEqual(['live']);
  });

  it('ignores a replay for a terminal that never attached', async () => {
    // The panel releases the buffer from its failure path too, where the attach may never have
    // reached the point of registering a connection.
    await expect(service.replayInitial('terminal-unknown')).resolves.toBeUndefined();
  });

  it('clears the screen before replaying a reconnected terminal', async () => {
    const output: string[] = [];
    await service.connect('terminal-1', 3, (data) => output.push(data));
    const replaying = service.replayInitial('terminal-1');
    await vi.waitFor(() => expect(resolveScrollback).toBeDefined());
    resolveScrollback?.({ data: 'scrollback', sequence: 8, runtimeRevision: 3 });
    await replaying;
    output.length = 0;
    commandHandler = () => Promise.resolve({ data: 'redrawn', sequence: 12, runtimeRevision: 3 });

    await service.replayAll();

    expect(output).toEqual([CLEAR_SCREEN, 'redrawn']);
  });

  it('redraws a terminal from the backend screen when its grid moves', async () => {
    // A grid change makes what is on screen stale: it was drawn for the old width, and rewrapping
    // it produces something the agent never drew. Only the backend re-lays its screen out.
    const output: string[] = [];
    await service.connect('terminal-1', 3, (data) => output.push(data));
    const replaying = service.replayInitial('terminal-1');
    await vi.waitFor(() => expect(resolveScrollback).toBeDefined());
    resolveScrollback?.({ data: 'drawn for 120 columns', sequence: 8, runtimeRevision: 3 });
    await replaying;
    output.length = 0;
    commandHandler = () =>
      Promise.resolve({ data: 'drawn for 80 columns', sequence: 12, runtimeRevision: 3 });

    await service.redraw('terminal-1');

    expect(output).toEqual([CLEAR_SCREEN, 'drawn for 80 columns']);
  });

  it('ignores a redraw for a terminal that never attached', async () => {
    await expect(service.redraw('terminal-unknown')).resolves.toBeUndefined();
  });

  it('folds a burst of resyncs into one redraw per terminal', async () => {
    // Resyncs arrive per dropped frame, so a reload that is still settling raises several at
    // once. Each extra pass redraws the same screen, and the redraw is itself what keeps the UI
    // thread from reading the socket — which is what raised the next resync.
    await service.connect('terminal-1', 3, () => undefined);
    let reads = 0;
    const waiting: Array<(value: unknown) => void> = [];
    commandHandler = (command) => {
      if (command !== 'read_terminal_scrollback') {
        return Promise.resolve(undefined);
      }
      reads += 1;
      return new Promise((resolve) => waiting.push(resolve));
    };
    const answerPendingReads = () => {
      for (const resolve of waiting.splice(0)) {
        resolve({ data: 'redrawn', sequence: 12, runtimeRevision: 3 });
      }
    };

    const signals = [service.replayAll(), service.replayAll(), service.replayAll()];

    // The two signals raised during the first pass do not each start one of their own.
    await vi.waitFor(() => expect(reads).toBe(1));
    answerPendingReads();
    // They are worth one follow-up between them, because the stream moved on while the pass ran.
    await vi.waitFor(() => expect(reads).toBe(2));
    answerPendingReads();
    await Promise.all(signals);

    expect(reads).toBe(2);
  });

  it('does not let a resync start a second redraw of a terminal already redrawing', async () => {
    // Two passes over one connection interleave: each releases the buffer when it finishes, so
    // live output held for the first is written into the middle of the second one's history.
    const writes: Array<{ data: string; replayed: boolean }> = [];
    await service.connect('terminal-1', 3, (data, replayed) => writes.push({ data, replayed }));

    const initial = service.replayInitial('terminal-1');
    await vi.waitFor(() => expect(resolveScrollback).toBeDefined());
    const concurrent = service.replayAll();
    emitOutput('live', 9);
    resolveScrollback?.({ data: 'history', sequence: 8, runtimeRevision: 3 });
    await Promise.all([initial, concurrent]);

    // The history is written once, and the live output that waited behind it follows it.
    expect(writes).toEqual([
      { data: 'history', replayed: true },
      { data: 'live', replayed: false },
    ]);
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
