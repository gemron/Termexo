import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
  checkLinuxRuntime,
  linuxCacheRoot,
  prepareLinuxApplication,
} from '../lib/linux.js';
import { launchNativeApplication, openNativeDownloadPage } from '../lib/native-launch.js';

const unix = { skip: process.platform === 'win32' };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'termexo-linux-npm-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const binary = join(source, 'usr/bin/termexo');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const archivePath = join(root, 'Termexo.tar.gz');
  execFileSync('tar', ['-czf', archivePath, '-C', source, 'usr']);
  return { version: '0.11.0', arch: 'x64', archivePath, cacheRoot: join(root, "cache's ! 中文") };
}

test(
  'Linux extraction preserves executable modes/resources and reuses the content-specific cache',
  unix,
  (t) => {
    const options = fixture(t);
    const binary = prepareLinuxApplication(options);
    assert.equal(execFileSync(binary).length, 0);
    assert.equal(
      prepareLinuxApplication({
        ...options,
        extract() {
          assert.fail('Do not re-extract a complete cache');
        },
      }),
      binary,
    );
    assert.equal(readdirSync(options.cacheRoot).length, 1);
    rmSync(binary);
    assert.equal(prepareLinuxApplication(options), binary, 'Repair a damaged executable cache');
    assert(!readdirSync(options.cacheRoot).some((name) => name.startsWith('.extract-')));
  },
);

test(
  'Linux extraction rejects incomplete or non-executable applications and cleans its temporary files',
  unix,
  (t) => {
    const options = fixture(t);
    assert.throws(
      () =>
        prepareLinuxApplication({
          ...options,
          extract(_archive, destination) {
            const binary = join(destination, 'usr/bin/termexo');
            mkdirSync(dirname(binary), { recursive: true });
            writeFileSync(binary, 'not executable');
          },
        }),
      /complete executable Linux application/,
    );
    assert.deepEqual(readdirSync(options.cacheRoot), []);
    writeFileSync(options.archivePath, 'corrupted archive');
    assert.throws(() => prepareLinuxApplication(options));
    assert.deepEqual(readdirSync(options.cacheRoot), []);
  },
);

test('Linux rejects unsupported architecture/version paths before opening an archive', unix, () => {
  assert.throws(
    () => prepareLinuxApplication({ version: '0.11.0', arch: 'arm64' }),
    /Unsupported Linux architecture/,
  );
  assert.throws(
    () => prepareLinuxApplication({ version: '../escape', arch: 'x64' }),
    /Invalid Termexo package version/,
  );
  assert.equal(linuxCacheRoot({ XDG_CACHE_HOME: '/cache' }, '/home/user'), '/cache/Termexo/npm');
  assert.equal(
    linuxCacheRoot({ XDG_CACHE_HOME: 'relative' }, '/home/user'),
    '/home/user/.cache/Termexo/npm',
  );
});

test(
  'Linux runtime checks distinguish headless sessions, missing shared libraries, and unusable executables',
  unix,
  (t) => {
    const binary = prepareLinuxApplication(fixture(t));
    assert.throws(() => checkLinuxRuntime(binary, { environment: {} }), /graphical Linux desktop/);
    assert.throws(
      () =>
        checkLinuxRuntime(binary, {
          environment: { DISPLAY: ':99' },
          probe: () => ({ status: 0, stdout: 'libwebkit2gtk-4.1.so => not found' }),
        }),
      /libwebkit2gtk-4\.1\.so => not found/,
    );
    assert.throws(
      () =>
        checkLinuxRuntime(binary, {
          environment: { DISPLAY: ':99' },
          probe: () => ({ error: new Error('timed out') }),
        }),
      /timed out/,
    );
    checkLinuxRuntime(binary, {
      environment: { WAYLAND_DISPLAY: 'wayland-0' },
      probe: () => ({ status: 0, stdout: 'libc.so => /lib/libc.so' }),
    });
    chmodSync(binary, 0o644);
    assert.throws(() => checkLinuxRuntime(binary), /not executable/);
  },
);

test(
  'native launch reports a real spawn error and runs an executable containing shell characters',
  unix,
  async (t) => {
    await assert.rejects(launchNativeApplication('/missing/termexo'), /ENOENT/);
    const options = fixture(t);
    const binary = prepareLinuxApplication(options);
    const marker = join(options.cacheRoot, 'launched');
    writeFileSync(binary, `#!/bin/sh\nprintf started > "$(dirname "$0")/../../launched"\n`);
    await launchNativeApplication(binary);
    const expected = join(dirname(binary), '../../launched');
    for (let count = 0; count < 30 && !existsSync(expected); count++) await delay(50);
    assert(existsSync(expected), `The literal executable path must be launched: ${marker}`);
  },
);

test('macOS native launcher uses Launch Services without parsing an app path through a shell', async () => {
  let invocation;
  await launchNativeApplication("/Users/test/App's 中文/Termexo.app", {
    platform: 'darwin',
    spawnProcess(command, args, options) {
      invocation = { command, args, options };
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  assert.equal(invocation.command, '/usr/bin/open');
  assert.deepEqual(invocation.args, ['-a', "/Users/test/App's 中文/Termexo.app"]);
  assert.equal(invocation.options.shell, undefined);
});

test('Unix download launch uses its URL handler and propagates spawn failures', async () => {
  for (const [platform, command] of [
    ['linux', 'xdg-open'],
    ['darwin', '/usr/bin/open'],
  ]) {
    const url = 'https://example.com/releases?tag=v1&platform=desktop';
    await openNativeDownloadPage(url, {
      platform,
      spawnProcess(actual, args) {
        assert.equal(actual, command);
        assert.deepEqual(args, [url]);
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
    });
  }
  await assert.rejects(
    openNativeDownloadPage('https://example.com', {
      spawnProcess() {
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('error', new Error('xdg-open missing')));
        return child;
      },
    }),
    /xdg-open missing/,
  );
});
