import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'linux', 'Build the Linux-only npm archive on Linux.');
const source = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] ?? 'validation-results/linux-npm');
const temporary = mkdtempSync(join(tmpdir(), 'termexo-npm-linux-pack-'));
try {
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  pkg.os = ['linux'];
  pkg.cpu = ['x64'];
  pkg.files = pkg.files.filter(
    (path) => !path.startsWith('vendor/') || path.startsWith('vendor/linux-'),
  );
  pkg.description = 'Run the Termexo desktop workspace on Linux x64';
  writeFileSync(join(temporary, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const name of ['bin', 'lib', 'scripts', 'README.md', 'vendor/linux-x64'])
    cpSync(join(source, name), join(temporary, name), { recursive: true });
  mkdirSync(output, { recursive: true });
  const args = ['pack', temporary, '--pack-destination', output];
  if (process.env.npm_execpath)
    execFileSync(process.execPath, [process.env.npm_execpath, ...args], { stdio: 'inherit' });
  else execFileSync('npm', args, { stdio: 'inherit' });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
