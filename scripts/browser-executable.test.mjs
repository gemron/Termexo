import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBrowserExecutable } from '../apps/desktop-ui/scripts/lib/browser-executable.mjs';

test('Linux browser scripts select installed Chromium instead of a Windows Edge path', () => {
  assert.equal(
    resolveBrowserExecutable({
      environment: {},
      platform: 'linux',
      executable: (path) => path === '/usr/bin/chromium',
      bundled: '/cache/missing',
    }),
    '/usr/bin/chromium',
  );
});

test('browser overrides are respected and invalid overrides fail clearly', () => {
  assert.equal(
    resolveBrowserExecutable({
      environment: { BROWSER_PATH: '/my/browser' },
      executable: (path) => path === '/my/browser',
    }),
    '/my/browser',
  );
  assert.throws(
    () =>
      resolveBrowserExecutable({ environment: { EDGE_PATH: '/missing' }, executable: () => false }),
    /not runnable/,
  );
});
