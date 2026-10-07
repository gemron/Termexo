import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { Terminal } from '@xterm/xterm';
import { vi } from 'vitest';
import { I18nService } from '../core/i18n/i18n.service';
import type { TerminalSession } from '../core/models/workspace.models';
import { PtyBackendService } from '../core/services/pty-backend.service';
import { TerminalGatewayService } from '../core/services/terminal-gateway.service';
import { TerminalPanelComponent } from './terminal-panel';
import type { TerminalReplayGate } from './terminal-replay-gate';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
}));

interface ClipboardHandlers {
  terminal: Terminal;
  replayGate: TerminalReplayGate;
  handleCustomKey(event: KeyboardEvent): boolean;
  handleContextMenu(event: MouseEvent): void;
  pasteFromClipboard(): Promise<void>;
  copyForProgram(payload: string): boolean;
}

describe('terminal clipboard interactions', () => {
  let fixture: ComponentFixture<TerminalPanelComponent>;
  let handlers: ClipboardHandlers;
  const write = vi.fn();
  const session: TerminalSession = {
    id: 'paste-terminal',
    name: 'PowerShell',
    agentType: 'shell',
    status: 'IDLE',
    shell: 'powershell.exe',
    workingDirectory: 'C:\\',
    model: '',
    branch: '',
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
    write.mockResolvedValue(undefined);
    vi.mocked(readText).mockResolvedValue('  中文\r\nsecond line\t ');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TerminalGatewayService,
          useValue: { write, setPalette: vi.fn(), onReconnected: () => () => undefined },
        },
        { provide: PtyBackendService, useValue: { backend: signal(null) } },
      ],
    });
    // Exercise the actual handlers without opening a GPU-backed terminal or starting a PTY.
    TestBed.overrideComponent(TerminalPanelComponent, { set: { template: '' } });
    vi.spyOn(TerminalPanelComponent.prototype, 'ngAfterViewInit').mockImplementation(
      () => undefined,
    );
    await TestBed.compileComponents();
    TestBed.inject(I18nService).setPreference('en');
    fixture = TestBed.createComponent(TerminalPanelComponent);
    fixture.componentRef.setInput('session', session);
    handlers = fixture.componentInstance as unknown as ClipboardHandlers;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    handlers?.terminal.dispose();
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
    vi.restoreAllMocks();
  });

  for (const combination of [
    { key: 'v', ctrlKey: true },
    { key: 'V', ctrlKey: true, shiftKey: true },
    { key: 'Insert', shiftKey: true },
  ]) {
    it(`pastes ${JSON.stringify(combination)} exactly once with no extra Enter`, async () => {
      const event = new KeyboardEvent('keydown', { ...combination, cancelable: true });
      expect(handlers.handleCustomKey(event)).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      await vi.waitFor(() =>
        expect(write).toHaveBeenCalledExactlyOnceWith(session, '  中文\r\nsecond line\t '),
      );
      expect(readText).toHaveBeenCalledOnce();
    });
  }

  it('pastes on right-click with no selection', async () => {
    const event = new MouseEvent('contextmenu', { cancelable: true });
    handlers.handleContextMenu(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  });

  it('ignores key repeats, keyup and empty clipboard contents', async () => {
    handlers.handleCustomKey(
      new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, repeat: true }),
    );
    handlers.handleCustomKey(new KeyboardEvent('keyup', { key: 'v', ctrlKey: true }));
    expect(readText).not.toHaveBeenCalled();
    vi.mocked(readText).mockResolvedValue('');
    await handlers.pasteFromClipboard();
    expect(write).not.toHaveBeenCalled();
  });

  it('reports a paste failure through the toast output without marking the agent failed', async () => {
    const notice = vi.fn();
    const status = vi.fn();
    fixture.componentInstance.interactionFailed.subscribe(notice);
    fixture.componentInstance.statusChanged.subscribe(status);
    vi.mocked(readText).mockRejectedValue('Clipboard is busy');
    await handlers.pasteFromClipboard();
    expect(notice).toHaveBeenCalledWith('Could not paste from the clipboard: Clipboard is busy');
    expect(write).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('preserves a right-click selection when copying fails instead of pasting', async () => {
    const notice = vi.fn();
    fixture.componentInstance.interactionFailed.subscribe(notice);
    vi.spyOn(handlers.terminal, 'getSelection').mockReturnValue('selected text');
    const clear = vi.spyOn(handlers.terminal, 'clearSelection');
    vi.mocked(writeText).mockRejectedValue('Clipboard is busy');
    handlers.handleContextMenu(new MouseEvent('contextmenu'));
    await vi.waitFor(() => expect(notice).toHaveBeenCalledOnce());
    expect(clear).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
  });

  it('refuses background and replayed OSC 52 writes even with native clipboard access', () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    handlers.copyForProgram('c;' + btoa('program text'));
    focus.mockReturnValue(true);
    handlers.replayGate.begin();
    handlers.copyForProgram('c;' + btoa('program text'));
    expect(writeText).not.toHaveBeenCalled();
    handlers.replayGate.end();
    handlers.copyForProgram('c;' + btoa('program text'));
    expect(writeText).toHaveBeenCalledExactlyOnceWith('program text');
  });
});
