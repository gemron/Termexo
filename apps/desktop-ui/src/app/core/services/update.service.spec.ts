import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { PERIODIC_CHECK_INTERVAL_MS, UpdateService } from './update.service';

describe('UpdateService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('checks on launch by default and persists an opt-out', () => {
    const service = TestBed.inject(UpdateService);
    expect(service.autoCheckEnabled()).toBe(true);

    service.setAutoCheckEnabled(false);
    expect(service.autoCheckEnabled()).toBe(false);
    expect(window.localStorage.getItem('termexo.autoCheckUpdates')).toBe('false');
  });

  it('reads a stored opt-out on creation', () => {
    window.localStorage.setItem('termexo.autoCheckUpdates', 'false');
    expect(TestBed.inject(UpdateService).autoCheckEnabled()).toBe(false);
  });

  it('reports nothing to notify about before a check has run', () => {
    expect(TestBed.inject(UpdateService).shouldNotify()).toBe(false);
  });

  it('resolves to null in browser preview, where no packaged version exists', async () => {
    await expect(TestBed.inject(UpdateService).check()).resolves.toBeNull();
  });

  it('stays silent on startup when the user opted out', async () => {
    const service = TestBed.inject(UpdateService);
    service.setAutoCheckEnabled(false);

    await service.checkOnStartup();

    expect(service.result()).toBeNull();
    expect(service.error()).toBeNull();
  });

  it('schedules periodic checks only in the desktop runtime', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    // Browser preview has no packaged version, so a timer there would only waste requests.
    TestBed.inject(UpdateService).startPeriodicChecks(() => undefined);

    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();
  });

  it('retires the timer when auto-check is switched off', () => {
    const clearInterval = vi.spyOn(globalThis, 'clearInterval');
    const service = TestBed.inject(UpdateService);

    service.startPeriodicChecks(() => undefined);
    service.setAutoCheckEnabled(false);

    expect(service.autoCheckEnabled()).toBe(false);
    clearInterval.mockRestore();
  });

  it('stops periodic checks on destroy so no timer outlives the app', () => {
    const clearInterval = vi.spyOn(globalThis, 'clearInterval');
    const service = TestBed.inject(UpdateService);

    service.startPeriodicChecks(() => undefined);
    service.ngOnDestroy();

    // Idempotent: a second stop must not throw when no timer is pending.
    expect(() => service.stopPeriodicChecks()).not.toThrow();
    clearInterval.mockRestore();
  });

  describe('periodic scheduling with a fake clock', () => {
    // The runtime guard skips the timer in browser preview, so these drive the desktop path.
    let restoreRuntime: () => void;

    beforeEach(() => {
      vi.useFakeTimers();
      (globalThis as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
      restoreRuntime = () => {
        delete (globalThis as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
      };
    });

    afterEach(() => {
      restoreRuntime();
      vi.useRealTimers();
    });

    it('checks again once the interval elapses', async () => {
      const service = TestBed.inject(UpdateService);
      const check = vi.spyOn(service, 'check').mockResolvedValue(null);

      service.startPeriodicChecks(() => undefined);
      expect(check).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);
      expect(check).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);
      expect(check).toHaveBeenCalledTimes(2);
    });

    it('announces an available update through the callback', async () => {
      const service = TestBed.inject(UpdateService);
      const available = {
        currentVersion: '0.3.12',
        latestVersion: '0.4.0',
        updateAvailable: true,
        releaseUrl: 'https://github.com/gemron/Termexo/releases/tag/v0.4.0',
        installedViaNpm: false,
      };
      vi.spyOn(service, 'check').mockImplementation(async () => {
        (service as unknown as { resultValue: { set: (v: unknown) => void } }).resultValue.set(
          available,
        );
        return available;
      });
      const onUpdate = vi.fn();

      service.startPeriodicChecks(onUpdate);
      await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS);

      expect(onUpdate).toHaveBeenCalledWith(available);
    });

    it('makes no request after the preference is switched off', async () => {
      const service = TestBed.inject(UpdateService);
      const check = vi.spyOn(service, 'check').mockResolvedValue(null);

      service.startPeriodicChecks(() => undefined);
      service.setAutoCheckEnabled(false);
      await vi.advanceTimersByTimeAsync(PERIODIC_CHECK_INTERVAL_MS * 3);

      expect(check).not.toHaveBeenCalled();
    });
  });
});
