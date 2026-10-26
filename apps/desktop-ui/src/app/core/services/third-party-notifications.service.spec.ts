import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WechatEventTracker, DEFAULT_WECHAT_SETTINGS } from '../models/wechat-notifications';
import { ThirdPartyNotificationsService } from './third-party-notifications.service';
import { WechatNotificationsService } from './wechat-notifications.service';

const backend = vi.hoisted(() => ({ invoke: vi.fn() }));

describe('third party notification master gate', () => {
  let gate: ThirdPartyNotificationsService;
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: { invoke: backend.invoke }, configurable: true });
    backend.invoke.mockReset().mockImplementation(async (command, args) => {
      if (command === 'read_third_party_notifications') return { enabled: true };
      if (command === 'set_third_party_notifications_enabled') return { enabled: args.enabled };
      throw new Error('Unexpected command ' + command);
    });
    TestBed.configureTestingModule({});
    gate = TestBed.inject(ThirdPartyNotificationsService);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    document.querySelector('meta[name="termexo-remote"]')?.remove();
  });

  it('shares the initial read and waits for persisted settings before allowing delivery', async () => {
    expect(gate.canSend()).toBe(false);
    await Promise.all([gate.initialize(), gate.initialize()]);
    expect(backend.invoke).toHaveBeenCalledTimes(1);
    expect(gate.canSend()).toBe(true);
  });

  it('pauses while saving without changing any channel settings, then resumes', async () => {
    await gate.initialize();
    let finish!: (value: { enabled: boolean }) => void;
    backend.invoke.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const paused = gate.setEnabled(false);
    expect(gate.canSend()).toBe(false);
    expect(gate.saving()).toBe(true);
    await Promise.resolve();
    await gate.setEnabled(true); // A second click cannot race the pending save.
    expect(backend.invoke).toHaveBeenCalledTimes(2);
    finish({ enabled: false });
    await paused;
    expect(gate.enabled()).toBe(false);
    await gate.setEnabled(true);
    expect(gate.canSend()).toBe(true);
    expect(backend.invoke.mock.calls.map(([command]) => command)).toEqual([
      'read_third_party_notifications', 'set_third_party_notifications_enabled',
      'set_third_party_notifications_enabled',
    ]);
  });

  it('retains the saved state on failure and allows retry', async () => {
    await gate.initialize();
    backend.invoke.mockRejectedValueOnce(new Error('save failed'));
    await expect(gate.setEnabled(false)).rejects.toThrow('save failed');
    expect(gate.saving()).toBe(false);
    expect(gate.enabled()).toBe(true);
    await gate.setEnabled(false);
    expect(gate.enabled()).toBe(false);
  });

  it('fails closed on a read error and can retry initialization', async () => {
    backend.invoke.mockRejectedValueOnce(new Error('read failed'));
    await expect(gate.initialize()).rejects.toThrow('read failed');
    expect(gate.canSend()).toBe(false);
    await gate.initialize();
    expect(gate.canSend()).toBe(true);
  });

  it('does not invoke desktop notification settings from remote clients', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    const marker = document.createElement('meta');
    marker.name = 'termexo-remote';
    marker.content = JSON.stringify({ version: '0.10.15', secure: true });
    document.head.append(marker);
    await gate.initialize();
    await gate.setEnabled(true);
    expect(backend.invoke).not.toHaveBeenCalled();
    expect(gate.canSend()).toBe(false);
  });

  function channel() {
    const wechat = TestBed.inject(WechatNotificationsService);
    wechat.initialized.set(true);
    wechat.settings.set({ ...DEFAULT_WECHAT_SETTINGS, enabled: true });
    const send = vi.spyOn(wechat, 'send').mockResolvedValue({
      id: 'event', target: 'saved target', workspaceId: 'w', kind: 'completed',
      status: 'submitted', detail: '', createdAt: 0,
    });
    const collect = vi.spyOn(WechatEventTracker.prototype, 'collect');
    collect.mockReturnValueOnce([{ workspaceId: 'w', eventKey: 'event', kind: 'completed' }]);
    collect.mockReturnValue([]);
    return { wechat, send, collect };
  }

  it('discards queued notifications on pause, even when immediately resumed', async () => {
    await gate.initialize();
    const { wechat, send } = channel();
    wechat.observe([], {}, []);
    await gate.setEnabled(false);
    await gate.setEnabled(true);
    await wechat['queue'];
    expect(send).not.toHaveBeenCalled();
    expect(wechat.settings().enabled).toBe(true);
  });

  it('consumes paused events without replay and preserves channel opt-in', async () => {
    await gate.initialize();
    await gate.setEnabled(false);
    const { wechat, send, collect } = channel();
    wechat.observe([], {}, []);
    await gate.setEnabled(true);
    wechat.observe([], {}, []);
    await wechat['queue'];
    expect(collect).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    wechat.settings.update((value) => ({ ...value, enabled: false }));
    collect.mockReturnValueOnce([{ workspaceId: 'w', eventKey: 'next', kind: 'completed' }]);
    wechat.observe([], {}, []);
    await wechat['queue'];
    expect(send).not.toHaveBeenCalled();
  });
});
