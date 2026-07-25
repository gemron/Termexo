import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repositoryRoot = resolve('../..');
const projectNode = resolve(
  'node_modules',
  'node',
  'bin',
  process.platform === 'win32' ? 'node.exe' : 'node',
);
const tauriCli = resolve('node_modules', '@tauri-apps', 'cli', 'tauri.js');
const result = spawnSync(projectNode, [tauriCli, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Unable to start the Tauri CLI: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
