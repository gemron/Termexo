import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import type { Workflow } from '../src/protocol.js';

const project = process.cwd(), resuming = !!process.env.ONE_RING_E2E_RESUME;
const directory = resuming ? path.resolve(process.env.ONE_RING_E2E_RESUME!) : path.join(project, '.one-ring/e2e', String(Date.now()));
if (!directory.startsWith(path.join(project, '.one-ring/e2e') + path.sep)) throw new Error('E2E state must stay inside the isolated fixture directory.');
const root = path.join(directory, 'fixture');
mkdirSync(directory, { recursive: true });
if (!resuming) {
  cpSync('tests/fixtures/retry-policy', root, { recursive: true });
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=One Ring E2E', '-c', 'user.email=e2e@localhost', 'commit', '-qm', 'Initial test fixture']);
}
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(project, 'plugins/codex/server/index.mjs')],
  env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), ONE_RING_STATE_DIR: path.join(directory, 'state') }, stderr: 'pipe' });
const client = new Client({ name: 'one-ring-e2e-test-client', version: '0.1.0' }, { capabilities: { elicitation: { form: {} } } });
const confirmations: string[] = [];
client.setRequestHandler(ElicitRequestSchema, async request => {
  if (!request.params.message.includes('Retry parser fixture') || !request.params.message.includes('Artifact hash:')) throw new Error('Unexpected decision outside this explicit test fixture.');
  confirmations.push(request.params.message);
  return { action: 'accept', content: { confirmed: true } };
});
const stderr: string[] = [];
async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return (result.structuredContent as { result: T }).result;
}
let workflowId: string | undefined;
try {
  await client.connect(transport);
  transport.stderr?.on('data', chunk => stderr.push(String(chunk)));
  const model = process.env.ONE_RING_E2E_MODEL;
  const profile = { cli: 'codex', ...(model ? { model } : {}) };
  const existing = resuming ? (await call<{ id: string; root: string }[]>('one_ring_list')).find(w => w.root === root) : undefined;
  const created = existing ? await call<Workflow>('one_ring_status', { workflowId: existing.id }) : await call<Workflow>('one_ring_create_plan', { root, plan: {
    title: 'Retry parser fixture', goal: readFileSync(path.join(root, 'REQUIREMENTS.md'), 'utf8'),
    criteria: ['Integer numbers and trimmed decimal digit strings from 0 through 10 are accepted; zero is preserved.', 'Fractions, out-of-range values, mixed strings, booleans, null, undefined, blank input, NaN, infinity and unsupported objects return 3 without throwing.', 'Meaningful tests cover the specified boundary behavior and a short README documents accepted input; the project test command passes.'],
    steps: ['Inspect the existing implementation and tests.', 'Implement only the specified retry parser behavior.', 'Add meaningful boundary tests and concise input documentation.', 'Run node --test and report the exact changed files.'],
    implementer: profile, verifier: profile
  } });
  workflowId = created.id;
  console.log(JSON.stringify({ workflowId, fixture: path.relative(project, root), note: 'Fixture confirmations are simulated by this test client; Workers and filesystem changes are real.' }));
  await call('one_ring_request_decision', { workflowId, kind: resuming ? 'resume' : 'plan' });
  let workflow: Workflow = created;
  const deadline = Date.now() + 10 * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    workflow = await call<Workflow>('one_ring_wait', { workflowId, milliseconds: 5000 });
    const key = `${workflow.phase}:${workflow.runs.length}:${workflow.runs.at(-1)?.status}`;
    if (key !== last) { console.log(JSON.stringify({ phase: workflow.phase, runs: workflow.runs.map(r => ({ role: r.role, status: r.status })), reason: workflow.blockedReason })); last = key; }
    if (!['BUILDING', 'VERIFYING'].includes(workflow.phase)) break;
  }
  writeFileSync(path.join(directory, 'workflow.json'), JSON.stringify(workflow, null, 2));
  if (workflow.phase !== 'AWAITING_DELIVERY_APPROVAL') throw new Error(`No valid delivery: ${workflow.phase}: ${workflow.blockedReason || workflow.verification?.summary}`);
  assert(workflow.runs.length >= 2);
  assert.notEqual(workflow.runs[0]!.sessionId, workflow.runs.at(-1)!.sessionId);
  const accepted = await call<{ accepted: boolean; workflow: Workflow }>('one_ring_request_decision', { workflowId, kind: 'delivery' });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.workflow.phase, 'COMPLETED');
  const output = execFileSync(process.execPath, ['--test'], { cwd: root, encoding: 'utf8' });
  writeFileSync(path.join(directory, 'test-output.txt'), output);
  const module = await import(pathToFileURL(path.join(root, 'retry.js')).href);
  for (const value of [0, 10, '0', ' 10 ']) assert.equal(module.parseRetryCount(value), Number(String(value).trim()));
  for (const value of [-1, 11, 1.5, '4x', '0x10', true, null, '', NaN, Infinity, {}, Symbol('unsupported')]) assert.equal(module.parseRetryCount(value), 3);
  writeFileSync(path.join(directory, 'workflow.json'), JSON.stringify(accepted.workflow, null, 2));
  writeFileSync(path.join(directory, 'confirmation-test-evidence.json'), JSON.stringify({ simulatedHostConfirmations: true, count: confirmations.length, workflowId }, null, 2));
  console.log(JSON.stringify({ result: 'PASS', phase: accepted.workflow.phase, realWorkerRuns: accepted.workflow.runs.length, evidence: path.relative(project, directory), testOutput: output.slice(-700) }, null, 2));
} finally {
  await client.close();
  writeFileSync(path.join(directory, 'server-stderr.txt'), stderr.join(''));
}
