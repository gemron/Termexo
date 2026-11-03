import { spawn } from 'node:child_process';

/** Wait for the OS spawn result before reporting success; preserve paths as a single argv. */
export function launchNativeApplication(
  executable,
  { platform = process.platform, spawnProcess = spawn } = {},
) {
  const app = platform === 'darwin' && executable.endsWith('.app');
  return startDetached(
    app ? '/usr/bin/open' : executable,
    app ? ['-a', executable] : [],
    spawnProcess,
  );
}

export function openNativeDownloadPage(
  url,
  { platform = process.platform, spawnProcess = spawn } = {},
) {
  return startDetached(platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', [url], spawnProcess);
}

function startDetached(command, args, spawnProcess) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
