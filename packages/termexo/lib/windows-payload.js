import assert from 'node:assert/strict';

export const WINDOWS_PAYLOAD_FILES = [
  'termexo.exe',
  'conpty.dll',
  'OpenConsole.exe',
];

/** Check artifact-relative names before release assembly copies any downloaded files. */
export function validateWindowsPayloadInventory(files) {
  const names = new Set();
  for (const { name, sha256 } of files) {
    assert.ok(typeof name === 'string' && name.split('/').every(
      (part) => part && part !== '.' && part !== '..' && !/[\\:]/.test(part),
    ), `Invalid Windows payload path: ${name}`);
    assert.ok(!names.has(name), `Duplicate Windows payload path: ${name}`);
    assert.match(sha256, /^[a-f0-9]{64}$/, `Invalid checksum for ${name}`);
    names.add(name);
  }
  for (const name of WINDOWS_PAYLOAD_FILES) {
    assert.ok(names.has(name), `Missing Windows payload: ${name}`);
  }
  assert.equal(names.size, WINDOWS_PAYLOAD_FILES.length, 'Unexpected Windows payload files');
}
