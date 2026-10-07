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
});
