import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linuxPayloadComplete } from '../lib/linux.js';

assert.equal(process.platform, 'linux', 'Stage Linux payloads on Linux.');
assert.equal(process.arch, 'x64', 'The certified Linux build target is x64.');
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const deb = resolve(
  repository,
  process.argv[2] ?? `src-tauri/target/release/bundle/deb/Termexo_${pkg.version}_amd64.deb`,
);
const output = resolve(
  repository,
  process.env.TERMEXO_LINUX_ARTIFACT_DIR ?? 'validation-results/linux-npm/build',
);
const field = (name) =>
  execFileSync('dpkg-deb', ['--field', deb, name], { encoding: 'utf8' }).trim();
assert.equal(field('Version'), pkg.version, 'Debian package version mismatch');
assert.equal(field('Architecture'), 'amd64', 'Debian package architecture mismatch');
const temporary = mkdtempSync(join(tmpdir(), 'termexo-linux-stage-'));
try {
  execFileSync('dpkg-deb', ['-x', deb, temporary]);
  assert(!existsSync(join(temporary, 'usr/lib/Termexo/one-ring')), 'Removed runtime remains in Debian staging');
  assert(
    linuxPayloadComplete(temporary),
    'The Debian package is missing the complete executable/runtime payload',
  );
  for (const name of ['usr/bin/termexo']) {
    const header = readFileSync(join(temporary, name)).subarray(0, 20);
    assert.equal(header.subarray(0, 4).toString(), '\x7fELF', `${name}: invalid ELF`);
    assert.equal(header[4], 2, `${name}: expected ELF64`);
    assert.equal(header[5], 1, `${name}: expected little endian`);
    assert.equal(header.readUInt16LE(18), 62, `${name}: expected x86_64`);
  }
  mkdirSync(output, { recursive: true });
  const archiveName = `Termexo_${pkg.version}_linux_x64.tar.gz`;
  execFileSync('tar', ['-czf', join(output, archiveName), '-C', temporary, 'usr']);
  const debName = `Termexo_${pkg.version}_amd64.deb`;
  copyFileSync(deb, join(output, debName));
  const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const files = [debName, archiveName].map((name) => ({
    name,
    sha256: sha256(join(output, name)),
  }));
  writeFileSync(
    join(output, 'SHA256SUMS.txt'),
    files.map(({ name, sha256: hash }) => `${hash}  ${name}\n`).join(''),
  );
  const commit =
    process.env.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
  const dirty =
    !process.env.GITHUB_SHA &&
    Boolean(
      execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim(),
    );
  writeFileSync(
    join(output, 'build-info.json'),
    `${JSON.stringify({ version: pkg.version, commit, dirty, target: 'x86_64-unknown-linux-gnu', files }, null, 2)}\n`,
  );
  const vendor = fileURLToPath(new URL('../vendor/linux-x64/Termexo.tar.gz', import.meta.url));
  mkdirSync(dirname(vendor), { recursive: true });
  copyFileSync(join(output, archiveName), vendor);
  console.log(`Staged Linux x64 application and resources: ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
