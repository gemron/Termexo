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
  const canonical = realpathSync.native(root);
  assert.equal(workspaceRoot(root), canonical);
  if (process.platform === 'win32') {
    const alias = root.toUpperCase();
    assert.equal(path.relative(workspaceRoot(alias), canonical), '');
    const short = execFileSync('cmd.exe', ['/d', '/c', `for %I in ("${root}") do @echo %~sI`], { encoding: 'utf8', windowsHide: true }).trim();
    assert.equal(workspaceRoot(short), canonical);
  }
  assert.throws(() => workspaceRoot(nested), /not a subdirectory/);
});
