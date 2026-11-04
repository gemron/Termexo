import assert from 'node:assert/strict';
import { lstatSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tauri may reuse an old .app or Debian staging directory from the Rust cache.
// Remove only generated bundle staging so resources removed from config stay removed.
const repository = fileURLToPath(new URL('../', import.meta.url));
const targetRoot = resolve(repository, 'src-tauri/target');
const bundle = resolve(targetRoot, process.env.TARGET || '', 'release/bundle');
const path = relative(targetRoot, bundle);
assert(path && !isAbsolute(path) && !path.split(sep).includes('..'));
for (let current = bundle; current !== targetRoot; current = resolve(current, '..')) {
  const entry = lstatSync(current, { throwIfNoEntry: false });
  assert(!entry?.isSymbolicLink(), `Unexpected link in bundle staging: ${current}`);
}
rmSync(bundle, { recursive: true, force: true });
console.log(`Cleaned generated desktop bundles: ${bundle}`);
