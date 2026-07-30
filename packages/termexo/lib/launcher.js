import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASES_URL = 'https://github.com/gemron/Termexo/releases/latest';
export const BUNDLED_EXECUTABLE = fileURLToPath(
  new URL('../vendor/win32-x64/termexo.exe', import.meta.url),
);

export function executableCandidates(
  environment = process.env,
  bundledExecutable = BUNDLED_EXECUTABLE,
) {
  const candidates = [];
  const add = (value) => {
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  add(environment.TERMEXO_PATH);
  add(bundledExecutable);

  if (environment.LOCALAPPDATA) {
    add(win32.join(environment.LOCALAPPDATA, 'Termexo', 'termexo.exe'));
    add(win32.join(environment.LOCALAPPDATA, 'Programs', 'Termexo', 'termexo.exe'));
  }

  if (environment.ProgramFiles) {
    add(win32.join(environment.ProgramFiles, 'Termexo', 'termexo.exe'));
  }

  if (environment['ProgramFiles(x86)']) {
    add(win32.join(environment['ProgramFiles(x86)'], 'Termexo', 'termexo.exe'));
  }

  return candidates;
}

export function findExecutable(
  environment = process.env,
  fileExists = existsSync,
  bundledExecutable = BUNDLED_EXECUTABLE,
) {
  return executableCandidates(environment, bundledExecutable).find((candidate) =>
    fileExists(candidate),
  );
}

export function launchExecutable(executable, spawnProcess = spawn) {
  const child = spawnProcess(executable, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
}

export function openDownloadPage(spawnProcess = spawn) {
  const child = spawnProcess(
    'rundll32.exe',
    ['url.dll,FileProtocolHandler', RELEASES_URL],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  child.unref();
}
