import assert from 'node:assert/strict';

export const ONE_RING_FILES = [
  'plugin.json',
  'bundle.json',
  'server/index.mjs',
  'runtime/node.exe',
  'runtime/LICENSE.txt',
  'THIRD_PARTY_NOTICES.txt',
  'skills/one-ring/SKILL.md',
  'skills/setup/SKILL.md',
  'skills/status/SKILL.md',
];

export const WINDOWS_PAYLOAD_FILES = [
  'termexo.exe',
  'conpty.dll',
  'OpenConsole.exe',
  ...ONE_RING_FILES.map((name) => `one-ring/${name}`),
];

// Desktop installers keep Node. The npm launcher supplies its own Node executable instead.
export const WINDOWS_NPM_PAYLOAD_FILES = WINDOWS_PAYLOAD_FILES.filter((name) => name !== 'one-ring/runtime/node.exe');

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
}
