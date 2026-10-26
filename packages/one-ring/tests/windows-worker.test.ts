import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NativeRuntime, RunFailure, type RunRequest } from '../src/runtime.js';
import { windowsWorkerCommand, windowsCodexExecutable } from '../src/windows-worker.js';

const windows = { skip: process.platform !== 'win32' };
function fixture(code: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), "one-ring Windows ' 测试 "));
  const script = path.join(root, 'worker.cjs');
  writeFileSync(script, code);
  const request: RunRequest = { cwd: root, directory: path.join(root, 'artifacts'), role: 'verifier', profile: { cli: 'codex' }, prompt: "中文 ' $() & literal", schema: { type: 'object' }, signal: new AbortController().signal, onPid: () => {} };
  return { root, script, request };
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitFor(file: string) {
  for (let i = 0; i < 200; i++) { if (existsSync(file)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Timed out waiting for ${file}`);
}

test('Windows resolver rejects shell launchers without a native installation', windows, () => {
  const { root } = fixture(''); const command = path.join(root, 'codex.cmd');
  writeFileSync(command, '@echo unsafe');
  assert.throws(() => windowsCodexExecutable(command), /native Windows/);
  assert.equal(windowsCodexExecutable(process.execPath), process.execPath);
});

test('Windows Job collects UTF-8 JSONL and preserves literal paths and prompts', windows, async () => {
  const { script, request } = fixture(`const fs=require('node:fs');let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>prompt+=s);process.stdin.on('end',()=>{const args=process.argv;fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({prompt}));process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'windows-fixture'})+'\\n');const data=Buffer.from(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'node --test',exit_code:0,aggregated_output:'测试通过'}})+'\\n');const i=data.indexOf(Buffer.from('测试'));process.stdout.write(data.subarray(0,i+1));setTimeout(()=>{process.stdout.write(data.subarray(i+1));console.log(JSON.stringify({type:'turn.completed'}));},30);});`);
  const result = await new NativeRuntime(15000, process.execPath, [script]).run(request);
  assert.deepEqual(result.report, { prompt: request.prompt });
  assert.equal(result.commands[0]!.output, '测试通过');
  assert.equal(result.stoppedConfirmed, true);
});

test('Windows cancellation stops both Worker and grandchild before confirming termination', windows, async () => {
  const { root, script, request } = fixture(`const fs=require('node:fs');const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync('grandchild.pid',String(child.pid));setInterval(()=>{},1000);`);
  const abort = new AbortController(); request.signal = abort.signal;
  const running = new NativeRuntime(20000, process.execPath, [script]).run(request);
  await waitFor(path.join(root, 'grandchild.pid'));
  const pid = Number(readFileSync(path.join(root, 'grandchild.pid'), 'utf8'));
  assert(alive(pid)); abort.abort();
  await assert.rejects(running, error => error instanceof RunFailure && error.interrupted && error.stoppedConfirmed);
  assert.equal(alive(pid), false);
});

test('Windows timeout terminates the Job and never returns a success report', windows, async () => {
  const { script, request } = fixture('setInterval(()=>{},1000);');
  await assert.rejects(new NativeRuntime(5000, process.execPath, [script]).run(request), error => error instanceof RunFailure && error.stoppedConfirmed && /timed out/.test(error.message));
});

test('Windows Job removes surviving descendants when the direct Worker exits', windows, async () => {
  const { root, script, request } = fixture(`const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync('grandchild.pid',String(child.pid));child.unref();`);
  await assert.rejects(new NativeRuntime(15000, process.execPath, [script]).run(request), error => error instanceof RunFailure && error.stoppedConfirmed);
  assert.equal(alive(Number(readFileSync(path.join(root, 'grandchild.pid'), 'utf8'))), false);
});

test('Windows forced supervisor loss retains an unconfirmed termination result', windows, async () => {
  const { root, script, request } = fixture(`const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync('grandchild.pid',String(child.pid));setInterval(()=>{},1000);`);
  let supervisorPid = 0; request.onPid = pid => { supervisorPid = pid; };
  const running = new NativeRuntime(20000, process.execPath, [script]).run(request);
  await waitFor(path.join(root, 'grandchild.pid'));
  process.kill(supervisorPid);
  await assert.rejects(running, error => error instanceof RunFailure && !error.stoppedConfirmed);
  const pid = Number(readFileSync(path.join(root, 'grandchild.pid'), 'utf8'));
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(alive(pid), false);
});

test('Windows supervisor stops its Job when the owning MCP process dies', windows, async () => {
  const { root, script, request } = fixture(`const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync('grandchild.pid',String(child.pid));setInterval(()=>{},1000);`);
  const ownerScript = path.join(root, 'owner.mjs');
  writeFileSync(ownerScript, `import {NativeRuntime} from ${JSON.stringify(pathToFileURL(path.resolve('src/runtime.ts')).href)}; await new NativeRuntime(20000,process.execPath,[${JSON.stringify(script)}]).run({...${JSON.stringify(request)},signal:new AbortController().signal,onPid:()=>{}});`);
  const owner = spawn(process.execPath, ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href, ownerScript], { stdio: 'ignore', windowsHide: true });
  try {
    await waitFor(path.join(root, 'grandchild.pid'));
    const pid = Number(readFileSync(path.join(root, 'grandchild.pid'), 'utf8'));
    assert(alive(pid)); owner.kill();
    for (let i = 0; i < 100 && alive(pid); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(alive(pid), false);
  } finally { owner.kill(); }
});
