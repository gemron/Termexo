import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GlobalTerminalNotice } from '../models/terminal-notifications';
import { DesktopNotificationService, DESKTOP_NOTIFICATION_WINDOW } from './desktop-notification.service';

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  requestUserAttention: vi.fn(),
  focusChanged: undefined as ((event: { payload: boolean }) => void) | undefined,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    requestUserAttention: native.requestUserAttention,
    onFocusChanged: async (callback: typeof native.focusChanged) => {
      native.focusChanged = callback;
      return () => {};
    },
  }),
}));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => 'granted',
}));

const notice = (
  status: GlobalTerminalNotice['status'],
  terminalId = 'terminal-1',
): GlobalTerminalNotice => ({
  workspaceId: 'workspace-1',
  workspaceName: 'Project',
  terminalId,
  terminalName: 'Agent',
  status,
});

describe('DesktopNotificationService persistent taskbar attention', () => {
  let service: DesktopNotificationService;

  beforeEach(() => {
    native.invoke.mockReset().mockResolvedValue(undefined);
    native.requestUserAttention.mockReset();
    native.focusChanged = undefined;
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke: native.invoke },
      configurable: true,
    });
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_NOTIFICATION_WINDOW, useValue: {
      requestUserAttention: native.requestUserAttention,
      onFocusChanged: async (callback: typeof native.focusChanged) => { native.focusChanged = callback; return () => {}; },
    } }] });
    service = TestBed.inject(DesktopNotificationService);
  });

  afterEach(() => Reflect.deleteProperty(window, '__TAURI_INTERNALS__'));

  const settle = () => service['attentionQueue'];
  const attentionCalls = () =>
    native.invoke.mock.calls
      .filter(([command]) => command === 'set_taskbar_attention')
      .map(([command, args]) => [command, args]);

  it('keeps completion messages flashing until confirmed, without downgrading for the toast', async () => {
    const completed = [notice('COMPLETED')];
    service.syncTaskbarAttention(completed);
    await settle();
    await service.notify(completed);
    service.syncTaskbarAttention(completed);
    await settle();
    expect(attentionCalls()).toEqual([['set_taskbar_attention', { active: true }]]);
    expect(native.requestUserAttention).not.toHaveBeenCalled();

    service.syncTaskbarAttention([]);
    await settle();
    expect(attentionCalls().at(-1)).toEqual(['set_taskbar_attention', { active: false }]);
  });

  it('continues while any terminal still needs confirmation', async () => {
    service.syncTaskbarAttention([notice('WAITING_APPROVAL'), notice('COMPLETED', 'terminal-2')]);
    await settle();
    service.syncTaskbarAttention([notice('COMPLETED', 'terminal-2')]);
    await settle();
    expect(attentionCalls()).toHaveLength(1);
    service.syncTaskbarAttention([]);
    await settle();
    expect(attentionCalls().at(-1)).toEqual(['set_taskbar_attention', { active: false }]);
  });

  it('reasserts pending attention on focus instead of treating focus as confirmation', async () => {
    service.syncTaskbarAttention([notice('WAITING_INPUT')]);
    await settle();
    native.focusChanged?.({ payload: true });
    await settle();
    expect(attentionCalls().map(([, args]) => args)).toEqual([{ active: true }, { active: true }]);
    service.syncTaskbarAttention([]);
    await settle();
    native.focusChanged?.({ payload: true });
    await settle();
    expect(attentionCalls()).toHaveLength(3);
    expect(native.requestUserAttention).not.toHaveBeenCalled();
  });

  it('serializes a quick confirmation after a pending start request', async () => {
    let finish!: () => void;
    native.invoke.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    service.syncTaskbarAttention([notice('WAITING_APPROVAL')]);
    service.syncTaskbarAttention([]);
    await Promise.resolve();
    expect(attentionCalls()).toEqual([['set_taskbar_attention', { active: true }]]);
    finish();
    await settle();
    expect(attentionCalls().at(-1)).toEqual(['set_taskbar_attention', { active: false }]);
  });

  it('retries a failed native request when the pending notices are synchronized again', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    native.invoke.mockRejectedValueOnce(new Error('Window temporarily unavailable'));
    service.syncTaskbarAttention([notice('COMPLETED')]);
    await settle();
    service.syncTaskbarAttention([notice('COMPLETED')]);
    await settle();
    expect(attentionCalls()).toHaveLength(2);
    warning.mockRestore();
  });

  it('does not control the desktop taskbar from a remote or preview browser', async () => {
    TestBed.resetTestingModule();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    TestBed.configureTestingModule({});
    service = TestBed.inject(DesktopNotificationService);
    service.syncTaskbarAttention([notice('COMPLETED')]);
    await settle();
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
