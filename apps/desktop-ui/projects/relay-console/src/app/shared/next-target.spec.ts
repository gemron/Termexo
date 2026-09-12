import { safeNextTarget } from './next-target';

describe('safeNextTarget', () => {
  it('accepts the device paths the relay itself redirects from', () => {
    expect(safeNextTarget('/d/abcdefghijklmnopqrstuvwxyz/')).toBe('/d/abcdefghijklmnopqrstuvwxyz/');
    expect(safeNextTarget('/d/abc/assets/main.js?v=1')).toBe('/d/abc/assets/main.js?v=1');
    expect(safeNextTarget('/console/devices')).toBe('/console/devices');
  });

  // Anything that can leave this origin would make the login page a phishing redirector on the
  // relay's own domain, which is exactly what makes such a link convincing.
  it('refuses every target that could leave this relay', () => {
    for (const target of [
      '//evil.example.com/',
      '///evil.example.com/',
      '/\\evil.example.com/',
      'https://evil.example.com/',
      'javascript:alert(1)',
      'd/abc/',
      '',
      null,
      undefined,
    ]) {
      expect(safeNextTarget(target)).toBeNull();
    }
  });

  it('refuses a target carrying control characters or whitespace', () => {
    expect(safeNextTarget('/d/abc/\nSet-Cookie: a=b')).toBeNull();
    expect(safeNextTarget('/d/ abc/')).toBeNull();
  });
});
