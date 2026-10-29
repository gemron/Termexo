import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { windowsCodexExecutable } from '../src/windows-worker.js';

if (process.platform !== 'win32') throw new Error('This probe requires native Windows.');
mkdirSync('.one-ring/sandbox-probes', { recursive: true });
const directory = mkdtempSync(path.resolve('.one-ring/sandbox-probes/run-'));
const root = path.join(directory, 'workspace');
mkdirSync(root);
const outside = path.join(os.homedir(), `.one-ring-sandbox-denied-${Date.now()}`);
const executable = windowsCodexExecutable();
for (const policy of ['read-only', 'workspace-write']) {
  const inside = path.join(root, `${policy}.txt`);
  const script = path.join(root, `${policy}.cjs`);
  writeFileSync(script, `const fs=require('node:fs');for(const file of ${JSON.stringify([inside, outside])}){try{fs.writeFileSync(file,'probe');console.log(JSON.stringify({file,writable:true}));}catch(e){console.log(JSON.stringify({file,writable:false,code:e.code}));}}`);
  const result = spawnSync(executable, ['sandbox', '-C', root, '-P', policy === 'read-only' ? ':read-only' : ':workspace', '--', process.execPath, script], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  console.log(JSON.stringify({ policy, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }));
  assert.equal(result.status, 0, 'Sandbox setup or execution failed.');
  assert.equal(existsSync(inside), policy === 'workspace-write', 'Worker workspace permissions do not match the role.');
  assert.equal(existsSync(outside), false, 'Sandbox allowed a write outside the workspace.');
}
console.log(`Windows sandbox role checks passed; artifacts: ${directory}`);
