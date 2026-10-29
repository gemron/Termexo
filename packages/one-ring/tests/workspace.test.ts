import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceRoot } from '../src/workspace.js';

test('Git root checks accept Windows case aliases while rejecting actual subdirectories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'One-Ring-Workspace-'));
  execFileSync('git', ['init', '--quiet', root]);
  const nested = path.join(root, 'nested');
  mkdirSync(nested);
  assert.equal(workspaceRoot(root), realpathSync(root));
  if (process.platform === 'win32') {
    const alias = root.toUpperCase();
    assert.equal(path.relative(workspaceRoot(alias), root), '');
  }
  assert.throws(() => workspaceRoot(nested), /not a subdirectory/);
});
