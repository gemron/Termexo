import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const windows = process.platform === 'win32';
const result = spawnSync(
  windows ? 'scripts\\tauri-msvc.cmd' : process.execPath,
  windows ? process.argv.slice(2) : ['scripts/run-tauri.mjs', ...process.argv.slice(2)],
  {
    cwd: windows ? repository : fileURLToPath(new URL('../apps/desktop-ui/', import.meta.url)),
    shell: windows,
    stdio: 'inherit',
  },
);
if (result.error) console.error(`Unable to start Tauri: ${result.error.message}`);
process.exit(result.status ?? 1);
