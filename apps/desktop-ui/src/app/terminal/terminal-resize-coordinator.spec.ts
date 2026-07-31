import { vi } from 'vitest';

import { TerminalDimensions, TerminalResizeCoordinator } from './terminal-resize-coordinator';

describe('TerminalResizeCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('collapses rapid layout changes to the latest terminal dimensions', async () => {
    vi.useFakeTimers();
    const applied: TerminalDimensions[] = [];
    const coordinator = new TerminalResizeCoordinator(async (dimensions) => {
      applied.push(dimensions);
    }, vi.fn());

    coordinator.schedule({ cols: 80, rows: 24 });
    coordinator.schedule({ cols: 100, rows: 30 });
    coordinator.schedule({ cols: 120, rows: 36 });
    await vi.advanceTimersByTimeAsync(80);

    expect(applied).toEqual([{ cols: 120, rows: 36 }]);
    coordinator.dispose();
  });

  it('serializes resize requests and applies the newest pending dimensions last', async () => {
    vi.useFakeTimers();
    let releaseFirstResize: (() => void) | undefined;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const applied: TerminalDimensions[] = [];
    const coordinator = new TerminalResizeCoordinator(async (dimensions) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      applied.push(dimensions);
      if (applied.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstResize = resolve;
        });
      }
      activeRequests -= 1;
    }, vi.fn());

    coordinator.schedule({ cols: 80, rows: 24 });
    await vi.advanceTimersByTimeAsync(80);
    coordinator.schedule({ cols: 100, rows: 30 });
    coordinator.schedule({ cols: 120, rows: 36 });
    await vi.advanceTimersByTimeAsync(80);
    releaseFirstResize?.();
    await vi.runAllTimersAsync();

    expect(maximumActiveRequests).toBe(1);
    expect(applied).toEqual([
      { cols: 80, rows: 24 },
      { cols: 120, rows: 36 },
    ]);
    coordinator.dispose();
  });
});
