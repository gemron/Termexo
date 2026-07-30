import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RELEASES_URL,
  executableCandidates,
  findExecutable,
  launchExecutable,
  openDownloadPage,
} from '../lib/launcher.js';

test('TERMEXO_PATH has priority over standard installation directories', () => {
  const candidates = executableCandidates({
    TERMEXO_PATH: 'D:\\Apps\\Termexo\\termexo.exe',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  }, 'C:\\npm\\termexo.exe');

  assert.deepEqual(candidates, [
    'D:\\Apps\\Termexo\\termexo.exe',
    'C:\\npm\\termexo.exe',
    'C:\\Users\\test\\AppData\\Local\\Termexo\\termexo.exe',
    'C:\\Users\\test\\AppData\\Local\\Programs\\Termexo\\termexo.exe',
    'C:\\Program Files\\Termexo\\termexo.exe',
    'C:\\Program Files (x86)\\Termexo\\termexo.exe',
  ]);
});

test('duplicate executable candidates are removed', () => {
  const environment = {
    TERMEXO_PATH: 'C:\\Termexo\\termexo.exe',
    ProgramFiles: 'C:\\',
  };

  assert.deepEqual(executableCandidates(environment, 'C:\\Termexo\\termexo.exe'), [
    'C:\\Termexo\\termexo.exe',
  ]);
});

test('findExecutable returns the first existing candidate', () => {
  const environment = {
    TERMEXO_PATH: 'D:\\Missing\\termexo.exe',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
  };
  const expected = 'C:\\Users\\test\\AppData\\Local\\Programs\\Termexo\\termexo.exe';

  assert.equal(
    findExecutable(environment, (candidate) => candidate === expected, 'C:\\npm\\termexo.exe'),
    expected,
  );
});

test('findExecutable returns undefined when Termexo is not installed', () => {
  assert.equal(
    findExecutable({ LOCALAPPDATA: 'C:\\Local' }, () => false, 'C:\\npm\\termexo.exe'),
    undefined,
  );
});

test('findExecutable uses the bundled executable before installed copies', () => {
  const bundledExecutable = 'C:\\npm\\termexo.exe';
  assert.equal(
    findExecutable(
      {
        LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
      },
      () => true,
      bundledExecutable,
    ),
    bundledExecutable,
  );
});

test('launchExecutable starts a detached GUI process', () => {
  let invocation;
  let unrefCalled = false;
  launchExecutable('C:\\Termexo\\termexo.exe', (command, args, options) => {
    invocation = { command, args, options };
    return {
      unref() {
        unrefCalled = true;
      },
    };
  });

  assert.deepEqual(invocation, {
    command: 'C:\\Termexo\\termexo.exe',
    args: [],
    options: {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    },
  });
  assert.equal(unrefCalled, true);
});

test('openDownloadPage opens the official latest release URL', () => {
  let invocation;
  openDownloadPage((command, args, options) => {
    invocation = { command, args, options };
    return { unref() {} };
  });

  assert.deepEqual(invocation, {
    command: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', RELEASES_URL],
    options: {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  });
});
