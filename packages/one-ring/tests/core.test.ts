import { test as nativeTest } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Engine } from '../src/core.js';
import { Store } from '../src/store.js';
import { RunFailure, type Runtime, type RunRequest, type RunResult } from '../src/runtime.js';
import type { PlanInput, Verification } from '../src/protocol.js';

// Workflow creation intentionally requires the native Linux/Windows Worker lifecycle.
const test = ['linux', 'win32'].includes(process.platform) ? nativeTest : nativeTest.skip;

export const basicPlan: PlanInput = { title: 'Retry policy', goal: 'Fix retry parsing.', criteria: ['Zero is accepted.', 'Invalid inputs default to three.'], steps: ['Implement boundaries.', 'Test and document.'], implementer: { cli: 'codex' }, verifier: { cli: 'codex' } };
nativeTest('unsupported platforms reject Worker workflows before touching the project', { skip: process.platform !== 'darwin' }, () => {
  const store = new Store(mkdtempSync(path.join(os.tmpdir(), 'one-ring-platform-')));
  try { assert.throws(() => new Engine(store).create('/nonexistent-project', basicPlan), /Linux and Windows only/); }
  finally { store.close(); }
});
function setup(runtime?: Runtime, coordinatorTerminalId?: string) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'one-ring-core-'));
  const root = path.join(temporary, 'work');
  cpSync('tests/fixtures/retry-policy', root, { recursive: true });
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=One Ring Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'fixture']);
  const store = new Store(path.join(temporary, 'state'));
  const engine = new Engine(store, runtime || new FakeRuntime());
  const workflow = engine.create(root, basicPlan, coordinatorTerminalId);
  return { root, store, engine, workflow };
}
class FakeRuntime implements Runtime {
  calls: RunRequest[] = [];
  outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE' = 'PASS';
  badFiles = false;
  mutateVerifier = false;
  omitCriterion = false;
  noEvidence = false;
  async run(request: RunRequest): Promise<RunResult> {
    this.calls.push(request);
    request.onPid(process.pid);
    if (request.signal.aborted) throw new RunFailure('interrupted', true, true);
    if (request.role === 'implementer') {
      writeFileSync(path.join(request.cwd, 'retry.js'), `// fixture change ${this.calls.length}\nexport const fixed = true;\n`);
      return { report: { summary: 'Implemented', filesChanged: this.badFiles ? [] : ['retry.js'], checks: [], documentation: 'Not necessary for this fixture.', limitations: [] }, commands: [], stoppedConfirmed: true, sessionId: `implementer-${this.calls.length}` };
    }
    if (this.mutateVerifier) writeFileSync(path.join(request.cwd, 'retry.js'), 'verifier must not change this');
    const report: Verification = { outcome: this.outcome, summary: 'Observed fixture results', criteria: ['AC-1', 'AC-2'].map((id, i) => ({ id, status: this.outcome === 'FAIL' && i === 1 ? 'FAIL' : this.outcome === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'PASS', evidence: 'Executed independent fixture check.' })), checks: [{ command: 'node --test', exitCode: 0, summary: 'All checks passed.' }], issues: this.outcome === 'FAIL' ? ['Preserve invalid-input handling.'] : [] };
    if (this.omitCriterion) report.criteria.pop();
    return { report, commands: this.noEvidence ? [] : [{ command: (this as { lifecycle?: string }).lifecycle === 'termexo-interactive-v1' ? 'node --test' : '/bin/bash -lc "node --test"', exitCode: 0, output: 'tests passed' }], stoppedConfirmed: true, sessionId: `verifier-${this.calls.length}` };
  }
}
const approve = (engine: Engine, id: string, kind: 'plan' | 'repair' | 'delivery' | 'resume' = 'plan') => engine.applyDecision(engine.decision(id, kind), true, 'test-client');

class LiteralEvidenceRuntime extends FakeRuntime {
  readonly lifecycle = 'termexo-interactive-v1';
  async run(request: RunRequest): Promise<RunResult> {
    const result = await super.run(request);
    if (request.role !== 'verifier') return result;
    const command = String.raw`node -e "const clean=/[\t ]+$/;console.log(clean.test('clean'));"`;
    const report = result.report as Verification;
    report.checks = [{ command, exitCode: 0, summary: 'Literal JS check passed' }];
    result.commands = [{ command, exitCode: 0, output: 'false\n' }];
    mkdirSync(path.join(request.directory, 'check-0'), { recursive: true });
    writeFileSync(path.join(request.directory, 'interactive-instructions.md'), request.prompt);
    writeFileSync(path.join(request.directory, 'interactive-report.json'), JSON.stringify(report));
    writeFileSync(path.join(request.directory, 'check-0/evidence.json'), JSON.stringify(result.commands[0]));
    request.onSession?.({ terminalId: 'native-verifier', sessionId: result.sessionId });
    return result;
  }
}

async function legacyEvidenceFailure() {
  const runtime = new LiteralEvidenceRuntime(), context = setup(runtime);
  approve(context.engine, context.workflow.id); await context.engine.wait(context.workflow.id);
  assert.equal(context.engine.status(context.workflow.id).phase, 'AWAITING_DELIVERY_APPROVAL');
  const blocked = context.store.update(context.workflow.id, 'fixture.legacy-matcher-failure', w => {
    w.phase = 'BLOCKED'; w.resumePhase = 'VERIFYING'; w.pendingStop = false;
    w.blockedReason = `Reported check lacks actual command evidence: ${w.runs.at(-1)!.commands![0]!.command}`;
    w.verification = undefined; w.verifiedSnapshot = undefined;
  });
  return { ...context, runtime, blocked, directory: blocked.runs.at(-1)!.directory };
}

test('completed desktop PASS evidence recovers the legacy dollar-anchor failure without execution or delivery approval', async () => {
  const { store, runtime, blocked } = await legacyEvidenceFailure();
  const engine = new Engine(store);
  const recovered = engine.status(blocked.id);
  assert.equal(recovered.phase, 'AWAITING_DELIVERY_APPROVAL');
  assert.equal(recovered.verification?.outcome, 'PASS');
  assert.equal(recovered.blockedReason, undefined);
  assert.deepEqual(recovered.approvals, blocked.approvals);
  assert.equal(runtime.calls.length, 2);
  assert.equal(recovered.runs.length, 2);
  assert.equal(engine.status(blocked.id).revision, recovered.revision);
  assert.equal(store.events(blocked.id).filter((e: any) => e.type === 'verification.evidence.reconciled').length, 1);
  store.close();
});

for (const [label, change] of [
  ['source changed', (c: any) => writeFileSync(path.join(c.root, 'retry.js'), 'changed after verification')],
  ['receipt changed', (c: any) => writeFileSync(path.join(c.directory, 'check-0/evidence.json'), '{"exitCode":1}')],
  ['different plan', (c: any) => writeFileSync(path.join(c.directory, 'interactive-instructions.md'), 'Plan hash: another-plan')],
  ['no report', (c: any) => writeFileSync(path.join(c.directory, 'interactive-report.json'), '{}')],
  ['worker still active', (c: any) => c.store.update(c.blocked.id, 'fixture.active', (w: any) => { w.pendingStop = true; w.runs.at(-1).status = 'RUNNING'; })],
  ['different profile', (c: any) => c.store.update(c.blocked.id, 'fixture.profile', (w: any) => { w.runs.at(-1).profile.model = 'different'; })],
  ['no plan approval', (c: any) => c.store.update(c.blocked.id, 'fixture.no-approval', (w: any) => { w.approvals = []; })],
  ['unrelated blocker', (c: any) => c.store.update(c.blocked.id, 'fixture.other', (w: any) => { w.blockedReason = 'Worker timeout'; })],
] as const) test(`legacy evidence recovery preserves BLOCKED when ${label}`, async () => {
  const context = await legacyEvidenceFailure();
  change(context);
  assert.equal(new Engine(context.store).status(context.blocked.id).phase, 'BLOCKED');
  assert.equal(context.runtime.calls.length, 2);
  context.store.close();
});

test('the original desktop coordinator binding survives store reloads without becoming plan approval', () => {
  const terminalId = '12345678-1234-4234-8234-123456789abc';
  const { store, workflow } = setup(undefined, terminalId);
  const restored = new Store(store.directory);
  try {
    assert.equal(restored.get(workflow.id).coordinatorTerminalId, terminalId);
    assert.equal(restored.get(workflow.id).phase, 'AWAITING_PLAN_APPROVAL');
    assert.deepEqual(restored.get(workflow.id).approvals, []);
  } finally { restored.close(); store.close(); }
});

test('orphaned Windows jobs retain their lease until a Job stop receipt exists', () => {
  const { root, store, engine, workflow } = setup();
  const directory = path.join(store.directory, 'orphan-artifacts'); mkdirSync(directory);
  store.acquire(root, workflow.id);
  store.update(workflow.id, 'fixture.orphan', w => {
    w.phase = 'BUILDING'; w.executionOwnerPid = 2147483647;
    w.runs.push({ id: 'orphan-run', role: 'implementer', profile: { cli: 'codex' }, status: 'RUNNING', ownerPid: 2147483647, childPid: 2147483647, lifecycle: 'windows-job-v1', directory, startedAt: new Date().toISOString() });
  });
  assert.equal(engine.status(workflow.id).pendingStop, true);
  assert.throws(() => store.acquire(root, 'another-workflow'), /lease/);
  assert.throws(() => engine.decision(workflow.id, 'resume'), /confirmed stopped/);
  writeFileSync(path.join(directory, 'worker-stopped'), 'stopped');
  const reconciled = engine.status(workflow.id);
  assert.equal(reconciled.phase, 'BLOCKED');
  assert.equal(reconciled.pendingStop, false);
  assert.equal(reconciled.runs[0]!.status, 'INTERRUPTED');
  assert.doesNotThrow(() => engine.decision(workflow.id, 'resume'));
  assert.doesNotThrow(() => store.acquire(root, 'another-workflow'));
  store.close();
});

test('an already stopped orphaned Windows run is marked interrupted on first inspection', () => {
  const { store, engine, workflow } = setup();
  const directory = path.join(store.directory, 'stopped-orphan'); mkdirSync(directory);
  writeFileSync(path.join(directory, 'worker-stopped'), 'stopped');
  store.update(workflow.id, 'fixture.stopped.orphan', w => {
    w.phase = 'BUILDING'; w.executionOwnerPid = 2147483647;
    w.runs.push({ id: 'stopped-run', role: 'implementer', profile: { cli: 'codex' }, status: 'RUNNING', ownerPid: 2147483647, lifecycle: 'windows-job-v1', directory, startedAt: new Date().toISOString() });
  });
  const stopped = engine.status(workflow.id);
  assert.equal(stopped.phase, 'BLOCKED'); assert.equal(stopped.pendingStop, false);
  assert.equal(stopped.runs[0]!.status, 'INTERRUPTED');
  store.close();
});

test('interactive orphan recovery requires a desktop stop receipt and a fresh resume decision', async () => {
  let confirmed = false;
  const runtime = new FakeRuntime();
  const confirmStopped = async () => confirmed;
  const { root, store, workflow } = setup(runtime);
  const engine = new Engine(store, Object.assign(runtime, { lifecycle: 'termexo-interactive-v1', confirmStopped }));
  store.acquire(root, workflow.id);
  store.update(workflow.id, 'fixture.interactive.orphan', w => {
    w.phase = 'BUILDING'; w.executionOwnerPid = 2147483647;
    w.runs.push({ id: 'interactive-orphan', role: 'implementer', profile: { cli: 'codex' }, status: 'RUNNING', ownerPid: 2147483647, lifecycle: 'termexo-interactive-v1', terminalId: 'old-window', directory: store.directory, startedAt: new Date().toISOString() });
  });
  assert.equal((await engine.reconcile(workflow.id)).pendingStop, true);
  assert.throws(() => engine.decision(workflow.id, 'resume'), /confirmed stopped/);
  assert.throws(() => store.acquire(root, 'another-workflow'), /lease/);
  writeFileSync(path.join(root, 'partial.txt'), 'Preserve partial work');
  confirmed = true;
  const reconciled = await engine.stop(workflow.id);
  assert.equal(reconciled.phase, 'BLOCKED');
  assert.equal(reconciled.pendingStop, false);
  assert.equal(reconciled.runs[0]!.status, 'INTERRUPTED');
  assert.doesNotThrow(() => engine.decision(workflow.id, 'resume'));
  assert.doesNotThrow(() => store.acquire(root, 'another-workflow'));
  assert.equal(runtime.calls.length, 0);
  assert.equal(reconciled.approvals.length, 0);
  assert.equal(readFileSync(path.join(root, 'partial.txt'), 'utf8'), 'Preserve partial work');
  store.close();
});

test('a delayed desktop stop check cannot reconcile a changed workflow', async () => {
  const runtime = new FakeRuntime();
  const { store, workflow } = setup(runtime);
  store.update(workflow.id, 'fixture.blocked', w => {
    w.phase = 'BLOCKED'; w.pendingStop = true; w.resumePhase = 'BUILDING';
    w.runs.push({ id: 'old', role: 'implementer', profile: { cli: 'codex' }, status: 'UNKNOWN', ownerPid: 2147483647, lifecycle: 'termexo-interactive-v1', terminalId: 'old-window', directory: store.directory, startedAt: new Date().toISOString() });
  });
  const engine = new Engine(store, Object.assign(runtime, { confirmStopped: async () => {
    store.update(workflow.id, 'fixture.concurrent', w => { w.blockedReason = 'New information'; });
    return true;
  } }));
  const result = await engine.reconcile(workflow.id);
  assert.equal(result.pendingStop, true);
  assert.equal(result.runs[0]!.status, 'UNKNOWN');
  store.close();
});

test('no execution before approval; declined decisions preserve the waiting state', async () => {
  const runtime = new FakeRuntime(), { engine, store, workflow } = setup(runtime);
  const request = engine.decision(workflow.id, 'plan');
  engine.applyDecision(request, false, 'test-client');
  assert.equal(runtime.calls.length, 0);
  assert.equal(engine.status(workflow.id).phase, 'AWAITING_PLAN_APPROVAL');
  assert.throws(() => engine.decision(workflow.id, 'delivery'));
  store.close();
});

test('OpenCode implementation is pinned in the approved plan and independently verified by Codex', async () => {
  const runtime = Object.assign(new FakeRuntime(), { lifecycle: 'termexo-interactive-v1' });
  const { engine, store, workflow } = setup(runtime);
  const plan = { ...basicPlan, implementer: { cli: 'opencode' as const, model: 'opencode/test' } };
  assert.throws(() => engine.revise(workflow.id, { ...plan, implementer: { cli: 'opencode' } }, workflow.revision), /provider\/model/);
  const revised = engine.revise(workflow.id, plan, workflow.revision);
  const request = engine.decision(workflow.id, 'plan');
  assert(request.message.includes('opencode/test'));
  assert.equal(runtime.calls.length, 0);
  engine.applyDecision(request, true, 'test-client'); await engine.wait(workflow.id);
  assert.equal(engine.status(workflow.id).phase, 'AWAITING_DELIVERY_APPROVAL');
  assert.deepEqual(runtime.calls.map(call => [call.role, call.profile.cli]), [['implementer', 'opencode'], ['verifier', 'codex']]);
  assert.equal(runtime.calls[0]!.profile.model, revised.plan.implementer.model);
  store.close();
});
test('a real workspace workflow advances through distinct implementation and verifier records', async () => {
  const runtime = new FakeRuntime(), { engine, store, workflow } = setup(runtime);
  approve(engine, workflow.id); await engine.wait(workflow.id);
  const ready = engine.status(workflow.id);
  assert.equal(ready.phase, 'AWAITING_DELIVERY_APPROVAL');
  assert.equal(ready.runs.length, 2);
  assert.notEqual(ready.runs[0]!.sessionId, ready.runs[1]!.sessionId);
  assert.equal(approve(engine, workflow.id, 'delivery').phase, 'COMPLETED');
  assert.throws(() => engine.revise(workflow.id, basicPlan, engine.status(workflow.id).revision));
  store.close();
});
test('revised plans reject old decisions and duplicate approval cannot dispatch twice', async () => {
  const runtime = new FakeRuntime(), { engine, store, workflow } = setup(runtime);
  const old = engine.decision(workflow.id, 'plan');
  engine.revise(workflow.id, { ...basicPlan, goal: 'Updated complete goal.' }, workflow.revision);
  assert.throws(() => engine.applyDecision(old, true, 'test-client'), /stale/);
  const fresh = engine.decision(workflow.id, 'plan');
  engine.applyDecision(fresh, true, 'test-client');
  assert.throws(() => engine.applyDecision(fresh, true, 'test-client'));
  await engine.wait(workflow.id);
  assert.equal(runtime.calls.length, 2);
  store.close();
});
test('post-verification edits invalidate an already displayed acceptance request', async () => {
  const { engine, store, workflow, root } = setup();
  approve(engine, workflow.id); await engine.wait(workflow.id);
  const acceptance = engine.decision(workflow.id, 'delivery');
  writeFileSync(path.join(root, 'retry.js'), 'external user edit');
  assert.throws(() => engine.applyDecision(acceptance, true, 'test-client'));
  assert.equal(engine.status(workflow.id).phase, 'BLOCKED');
  assert.equal(readFileSync(path.join(root, 'retry.js'), 'utf8'), 'external user edit');
  store.close();
});
test('FAIL waits for one repair authorization and the authorized issue survives into the repair prompt', async () => {
  const runtime = new FakeRuntime(); runtime.outcome = 'FAIL';
  const { engine, store, workflow } = setup(runtime);
  approve(engine, workflow.id); await engine.wait(workflow.id);
  assert.equal(engine.status(workflow.id).phase, 'AWAITING_REPAIR_APPROVAL');
  assert.equal(runtime.calls.length, 2);
  runtime.outcome = 'PASS';
  approve(engine, workflow.id, 'repair'); await engine.wait(workflow.id);
  assert.match(runtime.calls[2]!.prompt, /Preserve invalid-input handling/);
  assert.equal(engine.status(workflow.id).repairRound, 1);
  assert.equal(engine.status(workflow.id).phase, 'AWAITING_DELIVERY_APPROVAL');
  store.close();
});
test('INCONCLUSIVE blocks and resumes verification only after a new decision', async () => {
  const runtime = new FakeRuntime(); runtime.outcome = 'INCONCLUSIVE';
  const { engine, store, workflow } = setup(runtime);
  approve(engine, workflow.id); await engine.wait(workflow.id);
  assert.equal(engine.status(workflow.id).phase, 'BLOCKED');
  runtime.outcome = 'PASS'; approve(engine, workflow.id, 'resume'); await engine.wait(workflow.id);
  assert.equal(runtime.calls.length, 3);
  assert.equal(runtime.calls[2]!.role, 'verifier');
  store.close();
});
for (const [name, configure] of [
  ['unreported actual changes', (runtime: FakeRuntime) => { runtime.badFiles = true; }],
  ['verifier modifying source', (runtime: FakeRuntime) => { runtime.mutateVerifier = true; }],
  ['missing acceptance criterion', (runtime: FakeRuntime) => { runtime.omitCriterion = true; }],
  ['checks without actual command evidence', (runtime: FakeRuntime) => { runtime.noEvidence = true; }]
] as const) test(`${name} cannot produce an acceptable delivery`, async () => {
  const runtime = new FakeRuntime(); configure(runtime);
  const { engine, store, workflow } = setup(runtime);
  approve(engine, workflow.id); await engine.wait(workflow.id);
  assert.equal(engine.status(workflow.id).phase, 'BLOCKED');
  assert.throws(() => engine.decision(workflow.id, 'delivery'));
  store.close();
});
test('a second MCP instance cannot revise or release another instance execution lease', async () => {
  const runtime: Runtime = { run: request => new Promise((_, reject) => {
    request.onPid(process.pid);
    request.signal.addEventListener('abort', () => reject(new RunFailure('stopped', true, true)), { once: true });
  }) };
  const { engine, store, workflow } = setup(runtime);
  approve(engine, workflow.id);
  await new Promise(resolve => setImmediate(resolve));
  const otherStore = new Store(store.directory), other = new Engine(otherStore);
  assert.throws(() => other.revise(workflow.id, basicPlan, other.status(workflow.id).revision), /Stop/);
  await assert.rejects(other.end(workflow.id, 'CANCELLED'), /another MCP instance/);
  await engine.stop(workflow.id);
  assert.equal(engine.status(workflow.id).phase, 'BLOCKED');
  otherStore.close(); store.close();
});
test('initial dirty workspaces are rejected without touching their files', () => {
  const { engine, store, root } = setup();
  writeFileSync(path.join(root, 'retry.js'), 'user changes');
  assert.throws(() => engine.create(root, basicPlan), /clean/);
  assert.equal(readFileSync(path.join(root, 'retry.js'), 'utf8'), 'user changes');
  store.close();
});
test('a second active workflow cannot be created through a path alias', () => {
  const { engine, store, root } = setup();
  assert.throws(() => engine.create(path.join(root, '.'), basicPlan), /active workflow/);
  store.close();
});
