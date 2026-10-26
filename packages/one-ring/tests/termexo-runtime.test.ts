import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInteractiveReport, verificationArgv } from '../src/termexo-runtime.js';
import { TermexoInteractiveRuntime } from '../src/termexo-runtime.js';
import { RunFailure, type RunRequest } from '../src/runtime.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RunRecord } from '../src/protocol.js';
import { spawnSync } from 'node:child_process';

const event = (payload: unknown) => JSON.stringify({ type: 'event_msg', payload });
test('interactive completion requires a native task_complete event containing structured JSON', () => {
  assert.deepEqual(readInteractiveReport(event({ type: 'agent_message', message: '{"outcome":"PASS"}' })), { completed: false, interrupted: false, report: undefined });
  const result = readInteractiveReport(event({ type: 'task_complete', last_agent_message: '{"outcome":"PASS"}' }));
  assert.equal(result.completed, true); assert.deepEqual(result.report, { outcome: 'PASS' });
  assert.equal(readInteractiveReport(event({ type: 'task_complete', last_agent_message: 'Done!' })).report, undefined);
});
test('a new interactive turn invalidates the preceding report and interruption stays visible', () => {
  const report = event({ type: 'task_complete', last_agent_message: '{"outcome":"PASS"}' });
  assert.equal(readInteractiveReport(report + '\n' + event({ type: 'task_started' })).completed, false);
  assert.equal(readInteractiveReport(event({ type: 'turn_aborted' })).interrupted, true);
  assert.equal(readInteractiveReport(event({ type: 'task_started' }) + '\n' + report + '\n' + event({ type: 'task_started' })).takenOver, true);
});
test('verification argv never interprets model-generated shell code', () => {
  assert.deepEqual(verificationArgv('node --test'), ['node', '--test']);
  assert.deepEqual(verificationArgv('git diff --check'), ['git', 'diff', '--check']);
  for (const command of ['node --test; echo OK', 'node $(whoami)', 'powershell -Command foo', 'cmd /c dir', 'node --test && exit 0', 'node "unterminated', 'node "a"extra', 'node --test\ngit status']) assert.throws(() => verificationArgv(command));
});
test('quoted verification code reaches Node intact without shell expansion', () => {
  const code = "const assert=require('node:assert/strict');assert(/<script>[\\s\\S]*<\\/script>/.test('<script>ok</script>'));assert.equal(process.argv[1],'$(whoami); & echo INJECTION');console.log('PELICAN_QUOTED_ARGV_OK');";
  const argv = verificationArgv(`node -e "${code}" '$(whoami); & echo INJECTION'`);
  assert.equal(argv[2], code);
  assert.deepEqual(verificationArgv('node --check "C:\\a folder\\script.js"'), ['node', '--check', 'C:\\a folder\\script.js']);
  const result = spawnSync(process.execPath, argv.slice(1), { encoding: 'utf8', shell: false, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'PELICAN_QUOTED_ARGV_OK');
});

function desktopFixture(live: boolean) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'termexo-native-cli-'));
  const transcript = path.join(directory, 'session.jsonl');
  writeFileSync(transcript, event({ type: 'task_complete', last_agent_message: '{"summary":"done"}' }));
  const calls: string[] = [];
  const client = { connect: async () => {}, close: async () => {}, callTool: async ({ name }: { name: string }) => {
    calls.push(name);
    const data = name === 'workspace_list' ? [{ id: 'workspace', projectPath: directory }]
      : name === 'agent_session_start' ? { id: 'native-terminal' }
      : { terminalId: 'native-terminal', sessionId: 'independent-session', transcriptPath: transcript, live, status: 'IDLE' };
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } };
  const request: RunRequest = { cwd: directory, directory: path.join(directory, 'artifacts'), role: 'implementer', profile: { cli: 'codex' }, prompt: 'Fixture', schema: {}, signal: new AbortController().signal, onPid: () => {} };
  return { calls, request, transcript, runtime: new TermexoInteractiveRuntime(process.execPath, path.join(directory, 'desktop.db'), 1000, () => client as any) };
}
test('native failed verification is preserved without replaying environment-dependent failed commands', async () => {
  const { request, transcript, runtime } = desktopFixture(true);
  request.role = 'verifier';
  const report = { outcome: 'FAIL', checks: [{ command: 'unsupported-browser-command', exitCode: 1 }], issues: ['Reduced-motion control is inconsistent'] };
  writeFileSync(transcript, event({ type: 'task_complete', last_agent_message: JSON.stringify(report) }));
  const result = await runtime.run(request);
  assert.deepEqual(result.report, report);
  assert.deepEqual(result.commands, []);
  assert.equal(result.stoppedConfirmed, true);
});
test('a PASS still requires replay and a replay error does not orphan a completed native turn', async () => {
  const { request, transcript, runtime } = desktopFixture(true);
  request.role = 'verifier';
  writeFileSync(transcript, event({ type: 'task_complete', last_agent_message: JSON.stringify({ outcome: 'PASS', checks: [{ command: 'cmd /c echo fake-pass', exitCode: 0 }] }) }));
  await assert.rejects(runtime.run(request), error => error instanceof RunFailure && error.stoppedConfirmed && /not supported/.test(error.message));
});
test('interactive runtime dispatches a real Agent session, binds its native ID and leaves it open', async () => {
  const { calls, request, runtime } = desktopFixture(true);
  const linked: unknown[] = []; request.onSession = session => linked.push(session);
  const result = await runtime.run(request);
  assert.equal(result.sessionId, 'independent-session');
  assert.deepEqual(result.report, { summary: 'done' });
  assert(calls.includes('agent_session_start')); assert(calls.includes('agent_session_inspect'));
  assert(!calls.includes('terminal_create')); assert(!calls.includes('terminal_close'));
  assert.deepEqual(linked.at(-1), { terminalId: 'native-terminal', sessionId: 'independent-session' });
});
test('a closed interactive window cannot be reported as successful completion', async () => {
  const { request, runtime } = desktopFixture(false);
  await assert.rejects(runtime.run(request), error => error instanceof RunFailure && !error.stoppedConfirmed && error.interrupted);
});

test('interactive stop reconciliation trusts only matching desktop-confirmed closed sessions', async () => {
  const run: RunRecord = { id: 'run', role: 'implementer', profile: { cli: 'codex' }, status: 'UNKNOWN', ownerPid: 1, lifecycle: 'termexo-interactive-v1', terminalId: 'old-terminal', sessionId: 'old-session', directory: os.tmpdir(), startedAt: new Date().toISOString() };
  for (const [response, expected] of [
    [{ terminalId: 'old-terminal', live: false, stoppedConfirmed: true, status: 'STOPPED' }, true],
    [{ terminalId: 'old-terminal', sessionId: 'old-session', live: false, stoppedConfirmed: true }, true],
    [{ terminalId: 'old-terminal', sessionId: 'different-session', live: false, stoppedConfirmed: true }, false],
    [{ terminalId: 'different-terminal', live: false, stoppedConfirmed: true }, false],
    [{ terminalId: 'old-terminal', live: true, stoppedConfirmed: true, status: 'IDLE' }, false],
    [{ terminalId: 'old-terminal', live: false }, false],
    [null, false],
  ] as const) {
    const client = { connect: async () => {}, close: async () => {}, callTool: async () => response === null
      ? { isError: true, content: [{ type: 'text', text: 'Desktop unavailable' }] }
      : { content: [{ type: 'text', text: JSON.stringify(response) }] } };
    const runtime = new TermexoInteractiveRuntime(process.execPath, 'desktop.db', 1000, () => client as any);
    assert.equal(await runtime.confirmStopped(run), expected, JSON.stringify(response));
  }
});
