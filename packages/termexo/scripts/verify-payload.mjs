import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WINDOWS_PAYLOAD_FILES } from '../lib/windows-payload.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

for (const name of pkg.os.includes('win32') ? WINDOWS_PAYLOAD_FILES : []) {
  const bytes = await readFile(new URL(`../vendor/win32-x64/${name}`, import.meta.url));
  assert.ok(bytes.length > 0, `Empty Windows payload: ${name}`);
  if (/\.(exe|dll)$/.test(name)) {
    assert.equal(bytes.subarray(0, 2).toString(), 'MZ', `Invalid Windows payload: ${name}`);
  }
}
for (const arch of pkg.os.includes('darwin') ? ['arm64', 'x64'] : []) {
  const bytes = await readFile(
    new URL(`../vendor/darwin-${arch}/Termexo.app.tar.gz`, import.meta.url),
  );
  assert.equal(bytes.readUInt16BE(0), 0x1f8b, `Missing or invalid macOS ${arch} app archive`);
}
if (pkg.os.includes('linux')) {
  const bytes = await readFile(new URL('../vendor/linux-x64/Termexo.tar.gz', import.meta.url));
  assert.equal(bytes.readUInt16BE(0), 0x1f8b, 'Missing or invalid Linux x64 app archive');
}
console.log(`Verified npm payloads for ${pkg.os.join(', ')}.`);
