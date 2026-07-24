import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const projectNode = resolve(
  'node_modules',
  'node',
  'bin',
  process.platform === 'win32' ? 'node.exe' : 'node',
);
const angularCli = resolve('node_modules', '@angular', 'cli', 'bin', 'ng.js');
const result = spawnSync(projectNode, [angularCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Unable to start the project Node runtime: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
