import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Terminal } from '@xterm/xterm';
import { I18nService } from '../core/i18n/i18n.service';
import type { TerminalSession } from '../core/models/workspace.models';
import { PtyBackendService } from '../core/services/pty-backend.service';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { TerminalPanelComponent } from './terminal-panel';

interface AttachmentHandlers {
  terminal: Terminal;
  viewReady: boolean;
  runtimeReady: boolean;
  connectionNotice(): string | null;
  initializeRuntime(): Promise<void>;
  setIdle(): void;
  handleOutput(data: string, replayed?: boolean): void;
  scheduleActivation(): void;
  replayGate: { replaying: boolean };
}

describe('terminal view attachment', () => {
  let fixture: ComponentFixture<TerminalPanelComponent>;
  let handlers: AttachmentHandlers;
  let reconnect: () => void;
  const stopOutput = vi.fn();
  const stopResize = vi.fn();
  const gateway = {
    connect: vi.fn(),
    onResized: vi.fn(),
    start: vi.fn(),
    replayInitial: vi.fn(),
    setPalette: vi.fn(),
    onReconnected: vi.fn(),
    write: vi.fn(),
  };
  const session: TerminalSession = {
    id: 'attached-agent',
    name: 'Agent',
    agentType: 'claude',
    status: 'STARTING',
    shell: 'powershell.exe',
    workingDirectory: 'C:\\',
    model: '',
    branch: '',
    runtimeRevision: 1,
  };

  function remote(): void {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    const marker = document.createElement('meta');
    marker.name = 'termexo-remote';
    marker.content = JSON.stringify({ version: '0.10.11', secure: false });
    document.head.append(marker);
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    gateway.connect.mockResolvedValue(stopOutput);
    gateway.onResized.mockResolvedValue(stopResize);
    gateway.start.mockResolvedValue({ attached: true, runtimeRevision: 0, cols: 80, rows: 24 });
    gateway.replayInitial.mockResolvedValue(undefined);
    gateway.write.mockResolvedValue(undefined);
    gateway.onReconnected.mockImplementation((handler) => {
      reconnect = handler;
      return () => undefined;
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: TerminalGatewayService, useValue: gateway },
        { provide: PtyBackendService, useValue: { backend: signal(null) } },
      ],
    });
    TestBed.overrideComponent(TerminalPanelComponent, { set: { template: '' } });
    vi.spyOn(TerminalPanelComponent.prototype, 'ngAfterViewInit').mockImplementation(
      () => undefined,
    );
    await TestBed.compileComponents();
    TestBed.inject(I18nService).setPreference('en');
    fixture = TestBed.createComponent(TerminalPanelComponent);
    fixture.componentRef.setInput('session', session);
    handlers = fixture.componentInstance as unknown as AttachmentHandlers;
    vi.spyOn(handlers.terminal, 'writeln').mockImplementation(() => undefined);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    handlers?.terminal.dispose();
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    document.querySelectorAll('meta[name="termexo-remote"]').forEach((node) => node.remove());
    vi.restoreAllMocks();
  });

  it('reports the actual running revision so the desktop accepts output again', async () => {
    const attached = vi.fn();
    fixture.componentInstance.runtimeAttached.subscribe(attached);
    await handlers.initializeRuntime();
    expect(attached).toHaveBeenCalledExactlyOnceWith({
      terminalId: session.id,
      runtimeRevision: 0,
    });
    expect(handlers.runtimeReady).toBe(true);
    expect(gateway.replayInitial).toHaveBeenCalledExactlyOnceWith(session.id);
  });

  it('never focuses the moving xterm input on touch, including explicit terminal taps', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    try {
      fixture.destroy();
      handlers.terminal.dispose();
      delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
      fixture = TestBed.createComponent(TerminalPanelComponent);
      fixture.componentRef.setInput('session', session);
      fixture.componentRef.setInput('active', true);
      handlers = fixture.componentInstance as unknown as AttachmentHandlers;
      const focus = vi.spyOn(handlers.terminal, 'focus').mockImplementation(() => undefined);
      vi.spyOn(handlers.terminal, 'write').mockImplementation(() => undefined);
      fixture.detectChanges();
      handlers.viewReady = true;
      for (let i = 0; i < 3; i++) {
        handlers.handleOutput('output');
        handlers.scheduleActivation();
        fixture.componentRef.setInput('session', { ...session, status: i % 2 ? 'THINKING' : 'RUNNING' });
        fixture.detectChanges();
      }
      expect(focus).not.toHaveBeenCalled();
      fixture.componentInstance.focus();
      expect(focus).not.toHaveBeenCalled();
      const textarea = document.createElement('textarea');
      document.body.append(textarea);
      vi.spyOn(handlers.terminal, 'textarea', 'get').mockReturnValue(textarea);
      const blur = vi.spyOn(textarea, 'blur');
      (handlers as unknown as { disableMobileTerminalInput(): void }).disableMobileTerminalInput();
      expect(textarea.disabled).toBe(true);
      expect(textarea.readOnly).toBe(true);
      expect(textarea.inputMode).toBe('none');
      expect(textarea.tabIndex).toBe(-1);
      expect(blur).toHaveBeenCalledOnce();
      textarea.remove();
    } finally {
      if (descriptor) Object.defineProperty(window, 'matchMedia', descriptor);
      else Reflect.deleteProperty(window, 'matchMedia');
    }
  });

  it('sends a mobile draft and Enter in one acknowledged write with bracketed paste preserved', async () => {
    handlers.runtimeReady = true;
    vi.spyOn(handlers.terminal, 'modes', 'get').mockReturnValue({ ...handlers.terminal.modes, bracketedPasteMode: true });
    vi.spyOn(handlers.terminal, 'scrollToBottom').mockImplementation(() => undefined);
    const mobile = fixture.componentInstance as unknown as { sendMobileText(text: string): Promise<void> };
    await mobile.sendMobileText('first\nsecond');
    expect(gateway.write).toHaveBeenCalledExactlyOnceWith(session, '\x1b[200~first\rsecond\x1b[201~\r');
    gateway.write.mockRejectedValueOnce(new Error('connection lost'));
    await expect(mobile.sendMobileText('retry')).rejects.toThrow('connection lost');
  });

  it('opens a new Codex without a task as idle, and preserves a turn reported during attachment', async () => {
    const codex = { ...session, agentType: 'codex' as const, nativeSessionId: undefined };
    fixture.componentRef.setInput('session', codex);
    const statuses = vi.fn();
    fixture.componentInstance.statusChanged.subscribe(statuses);
    await handlers.initializeRuntime();
    expect(statuses).toHaveBeenCalledExactlyOnceWith({ terminalId: codex.id, status: 'IDLE' });
    statuses.mockClear();
    fixture.componentRef.setInput('session', codex);
    gateway.replayInitial.mockImplementationOnce(async () => {
      fixture.componentRef.setInput('session', { ...codex, status: 'THINKING' });
    });
    await handlers.initializeRuntime();
    expect(statuses).not.toHaveBeenCalled();
  });

  it('manually corrects only working status without calling the PTY or completing a task', () => {
    const statuses = vi.fn();
    fixture.componentInstance.statusChanged.subscribe(statuses);
    fixture.componentRef.setInput('session', { ...session, status: 'RUNNING' });
    handlers.setIdle();
    expect(statuses).toHaveBeenCalledExactlyOnceWith({ terminalId: session.id, status: 'IDLE' });
    expect(gateway.start).not.toHaveBeenCalled();
    statuses.mockClear();
    fixture.componentRef.setInput('session', { ...session, status: 'WAITING_APPROVAL' });
    handlers.setIdle();
    expect(statuses).not.toHaveBeenCalled();
  });

  it('keeps a phone connection error local and retries when the bridge reconnects', async () => {
    remote();
    handlers.viewReady = true;
    const statuses = vi.fn();
    fixture.componentInstance.statusChanged.subscribe(statuses);
    gateway.start.mockRejectedValueOnce(new Error('Connection closed'));
    await handlers.initializeRuntime();
    expect(handlers.connectionNotice()).toContain('Connection closed');
    expect(statuses).not.toHaveBeenCalled();
    expect(stopOutput).toHaveBeenCalledOnce();
    expect(stopResize).toHaveBeenCalledOnce();
    reconnect();
    await vi.waitFor(() => expect(handlers.runtimeReady).toBe(true));
    expect(handlers.connectionNotice()).toBeNull();
    expect(statuses).not.toHaveBeenCalled();
    expect(gateway.start).toHaveBeenCalledTimes(2);
  });

  it('reports a genuine desktop launch failure as FAILED', async () => {
    const statuses = vi.fn();
    fixture.componentInstance.statusChanged.subscribe(statuses);
    gateway.start.mockRejectedValueOnce(new Error('Shell not found'));
    await handlers.initializeRuntime();
    expect(statuses).toHaveBeenCalledExactlyOnceWith({ terminalId: session.id, status: 'FAILED' });
    expect(handlers.terminal.writeln).toHaveBeenCalledWith(
      expect.stringContaining('Shell not found'),
    );
  });

  it('does not confuse a desktop event subscription error with an agent failure', async () => {
    const statuses = vi.fn();
    fixture.componentInstance.statusChanged.subscribe(statuses);
    gateway.onResized.mockRejectedValueOnce(new Error('Event bridge unavailable'));
    await handlers.initializeRuntime();
    expect(statuses).not.toHaveBeenCalled();
    expect(handlers.connectionNotice()).toContain('Event bridge unavailable');
    expect(stopOutput).toHaveBeenCalledOnce();
    expect(gateway.start).not.toHaveBeenCalled();
  });

  function remotePanel(): void {
    fixture.destroy();
    handlers.terminal.dispose();
    remote();
    fixture = TestBed.createComponent(TerminalPanelComponent);
    fixture.componentRef.setInput('session', { ...session, agentType: 'shell', status: 'RUNNING' });
    handlers = fixture.componentInstance as unknown as AttachmentHandlers;
    fixture.detectChanges();
  }

  it('coalesces remote output while delivering every live chunk to the output readers once', () => {
    remotePanel();
    let frame!: FrameRequestCallback;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1; });
    const write = vi.spyOn(handlers.terminal, 'write').mockImplementation(() => undefined);
    const captured = vi.fn();
    fixture.componentInstance.outputCaptured.subscribe(captured);
    handlers.handleOutput('\x1b[2J');
    handlers.handleOutput('answer');
    expect(write).not.toHaveBeenCalled();
    expect(captured.mock.calls).toEqual([[{ terminalId: session.id, data: '\x1b[2J' }], [{ terminalId: session.id, data: 'answer' }]]);
    frame(0);
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[2Janswer');
  });

  it('keeps replay input suppression until the complete remote history has been parsed', () => {
    remotePanel();
    let frame!: FrameRequestCallback;
    let parsed: (() => void) | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1; });
    const write = vi.spyOn(handlers.terminal, 'write').mockImplementation((_data, callback) => { parsed = callback; });
    const captured = vi.fn();
    fixture.componentInstance.outputCaptured.subscribe(captured);
    handlers.handleOutput('first half', true);
    handlers.handleOutput('second half', true);
    frame(0);
    expect(write.mock.calls[0][0]).toBe('first halfsecond half');
    expect(handlers.replayGate.replaying).toBe(true);
    expect(captured).not.toHaveBeenCalled();
    parsed?.();
    expect(handlers.replayGate.replaying).toBe(false);
  });

  it('leaves desktop writes immediate', () => {
    const write = vi.spyOn(handlers.terminal, 'write').mockImplementation(() => undefined);
    handlers.handleOutput('local output');
    expect(write).toHaveBeenCalledExactlyOnceWith('local output');
  });

  it.each(['COMPLETED', 'FAILED', 'STOPPED'] as const)('replays a %s common operation without executing its command again', async (status) => {
    fixture.componentRef.setInput('session', { ...session, agentType: 'shell', commonActionId: 'build', status });
    const statuses = vi.fn();
    fixture.componentInstance.statusChanged.subscribe(statuses);
    await handlers.initializeRuntime();
    expect(gateway.connect).toHaveBeenCalledOnce();
    expect(gateway.replayInitial).toHaveBeenCalledExactlyOnceWith(session.id);
    expect(gateway.start).not.toHaveBeenCalled();
    expect(statuses).not.toHaveBeenCalled();
  });
});
