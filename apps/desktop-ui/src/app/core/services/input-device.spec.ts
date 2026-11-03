import { vi } from 'vitest';
import { hasTouchInput } from './input-device';

describe('touch keyboard detection', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('recognizes Android even when desktop-site mode reports a fine pointer', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Android Chrome/140', platform: 'Linux arm', maxTouchPoints: 5 });
    expect(hasTouchInput()).toBe(true);
  });

  it('preserves normal desktop input on a Windows touchscreen with a mouse', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Windows NT 10.0 Chrome', platform: 'Win32', maxTouchPoints: 10 });
    expect(hasTouchInput()).toBe(false);
  });
});
