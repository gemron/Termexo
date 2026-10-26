import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NativeRuntime, workerArguments, RunFailure, type RunRequest } from '../src/runtime.js';

const base = (): RunRequest => { const directory = mkdtempSync(path.join(os.tmpdir(), 'one-ring-run-')); return { directory: path.join(directory, 'artifacts'), cwd: directory, role: 'verifier', profile: { cli: 'codex' }, prompt: 'Fixture prompt', schema: { type: 'object' }, signal: new AbortController().signal, onPid: () => {} }; };
test('Worker role restricts Codex source writes and disables orchestration capabilities', () => {
  const request = base(), args = workerArguments(request);
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert(args.includes('plugins') && args.includes('hooks') && args.includes('multi_agent'));
  assert(args.includes('mcp_servers={}'));
  assert(!args.some(arg => arg.includes('bypass')));
  assert.throws(() => workerArguments({ ...request, profile: { cli: 'pi' } }), /not yet certified/);
});
test('missing CLI is a confirmed stopped failure with no report', async () => {
  const runtime = new NativeRuntime(1000, '/nonexistent/one-ring-cli');
  await assert.rejects(runtime.run(base()), error => error instanceof RunFailure && error.stoppedConfirmed);
});
test('native JSONL collection handles split UTF-8 and requires a final JSON artifact', { skip: process.platform === 'win32' }, async () => {
  const request = base(), executable = path.join(request.cwd, 'fixture-worker');
  writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs');let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>prompt+=s);process.stdin.on('end',()=>{const args=process.argv;const out=args[args.indexOf('--output-last-message')+1];fs.writeFileSync(out,JSON.stringify({ok:true,prompt}));const text=Buffer.from(JSON.stringify({type:'item.completed',item:{type:'command_execution',command:'node --test',exit_code:0,aggregated_output:'测试通过'}})+'\\n');const i=text.indexOf(Buffer.from('测试'));process.stdout.write(JSON.stringify({type:'thread.started',thread_id:'fixture-session'})+'\\n');process.stdout.write(text.subarray(0,i+1));setTimeout(()=>process.stdout.end(Buffer.concat([text.subarray(i+1),Buffer.from(JSON.stringify({type:'turn.completed'})+'\\n')])),20);});`, { mode: 0o700 });
  const result = await new NativeRuntime(3000, executable).run(request);
  assert.deepEqual(result.report, { ok: true, prompt: 'Fixture prompt' });
  assert.equal(result.commands[0]!.output, '测试通过');
  assert.equal(result.stoppedConfirmed, true);
});
test('native interruption kills its process group and never reports success', { skip: process.platform === 'win32' }, async () => {
  const request = base(), executable = path.join(request.cwd, 'fixture-worker');
  writeFileSync(executable, `#!${process.execPath}\nsetInterval(()=>{},1000);`, { mode: 0o700 });
  const abort = new AbortController(); request.signal = abort.signal;
  request.onPid = () => setTimeout(() => abort.abort(), 60);
  await assert.rejects(new NativeRuntime(3000, executable).run(request), error => error instanceof RunFailure && error.interrupted && error.stoppedConfirmed);
  assert.equal(existsSync(path.join(request.directory, 'answer.json')), false);
});
