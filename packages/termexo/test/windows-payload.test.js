import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWindowsPayloadInventory, WINDOWS_PAYLOAD_FILES } from '../lib/windows-payload.js';

const inventory = () => WINDOWS_PAYLOAD_FILES.map((name) => ({ name, sha256: 'a'.repeat(64) }));

test('release inventory requires the built-in engine, runtime, skills and licenses', () => {
  assert.doesNotThrow(() => validateWindowsPayloadInventory(inventory()));
  for (const missing of WINDOWS_PAYLOAD_FILES) {
    assert.throws(
      () => validateWindowsPayloadInventory(inventory().filter(({ name }) => name !== missing)),
      /Missing Windows payload/,
    );
  }
});

test('downloaded inventories reject traversal, absolute paths, duplicates and invalid hashes', () => {
  for (const name of ['../outside', '/absolute', 'C:/absolute', 'one-ring/../../outside', 'one-ring\\outside', 'one-ring//file']) {
    assert.throws(() => validateWindowsPayloadInventory([...inventory(), { name, sha256: 'a'.repeat(64) }]), /Invalid Windows payload path/);
  }
  assert.throws(() => validateWindowsPayloadInventory([...inventory(), inventory()[0]]), /Duplicate/);
  assert.throws(() => validateWindowsPayloadInventory([{ name: 'termexo.exe', sha256: 'invalid' }]), /Invalid checksum/);
});
