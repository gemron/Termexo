import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { implementationSchema, verificationSchema, planInput, terminalPhases, errorMessage, type Approval, type PlanInput, type Workflow, type RunRecord, type Verification } from './protocol.js';
import { changedFiles, digest, existingChanges, snapshot, workspaceRoot } from './workspace.js';
import { Store } from './store.js';
import { NativeRuntime, RunFailure, type Runtime } from './runtime.js';
import { commandEvidenceMatches } from './command-evidence.js';
import { windowsWorkerStopped } from './windows-worker.js';

export type DecisionKind = Approval['kind'];
export type DecisionRequest = { workflowId: string; kind: DecisionKind; hash: string; revision: number; message: string };
const live = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };

export class Engine {
  private jobs = new Map<string, { abort: AbortController; done: Promise<void> }>();
  constructor(readonly store: Store, readonly runtime: Runtime = new NativeRuntime()) {}
  create(rootInput: string, input: PlanInput, coordinatorTerminalId?: string): Workflow {
    if (!['linux', 'win32'].includes(process.platform)) throw new Error('This preview supports Worker execution on Linux and Windows only.');
    const root = workspaceRoot(rootInput), data = planInput.parse(input);
    if (existingChanges(root).length) throw new Error('This preview requires an initially clean Git working tree. Preserve your edits and use a clean worktree; One Ring will not stash or reset them.');
    this.validateProfiles(data);
    const now = new Date().toISOString(), baseline = snapshot(root);
    const plan = { ...data, version: 1, hash: digest({ ...data, version: 1 }) };
    return this.store.create({ id: randomUUID(), root, phase: 'AWAITING_PLAN_APPROVAL', revision: 1, plan, baseline, lastSnapshot: baseline, approvals: [], runs: [], repairRound: 0, createdAt: now, updatedAt: now, ...(coordinatorTerminalId ? { coordinatorTerminalId: z.string().uuid().parse(coordinatorTerminalId) } : {}) });
  }
  private validateProfiles(data: PlanInput): void {
    if (data.verifier.cli !== 'codex' || !['codex', 'opencode'].includes(data.implementer.cli)) throw new Error('Use a Codex verifier and a Codex or OpenCode implementer.');
    if (data.implementer.cli === 'opencode') {
      if (this.runtime.lifecycle !== 'termexo-interactive-v1') throw new Error('OpenCode implementation requires the Termexo interactive runtime.');
      if (!data.implementer.model || !/^[^\s/]+\/[^\s]+$/.test(data.implementer.model)) throw new Error('Choose an explicit OpenCode provider/model before requesting plan approval.');
    }
  }
  status(id: string): Workflow {
    let workflow = this.store.get(id);
    if (['BUILDING', 'VERIFYING'].includes(workflow.phase) && !this.jobs.has(id)) {
      const run = workflow.runs.at(-1);
      const ownerPid = workflow.executionOwnerPid || run?.ownerPid;
      if (!ownerPid || !live(ownerPid)) {
        workflow = this.store.update(id, 'workflow.orphaned', w => {
          w.resumePhase = w.phase === 'BUILDING' ? 'BUILDING' : 'VERIFYING';
          w.phase = 'BLOCKED'; w.blockedReason = 'The owning MCP process exited. Inspect the recorded child process before continuing.';
          w.pendingStop = !run || (run.lifecycle === 'windows-job-v1' ? !windowsWorkerStopped(run.directory) : run.lifecycle === 'termexo-interactive-v1' || run.status === 'RUNNING' && (!run.childPid || live(run.childPid)));
          if (!w.pendingStop) {
            if (run?.lifecycle === 'windows-job-v1') {
              const last = w.runs.at(-1)!;
              if (['RUNNING', 'UNKNOWN'].includes(last.status)) { last.status = 'INTERRUPTED'; last.finishedAt = new Date().toISOString(); }
            }
            w.lastSnapshot = snapshot(w.root); this.store.release(w.root, id);
          }
        });
      }
    }
    if (workflow.phase === 'BLOCKED' && workflow.pendingStop && !this.jobs.has(id)) {
      const run = workflow.runs.at(-1);
      if (run?.lifecycle === 'windows-job-v1' && windowsWorkerStopped(run.directory)) {
        workflow = this.store.update(id, 'execution.stop.confirmed', w => {
          w.pendingStop = false; w.lastSnapshot = snapshot(w.root);
          const last = w.runs.at(-1)!;
          if (['RUNNING', 'UNKNOWN'].includes(last.status)) { last.status = 'INTERRUPTED'; last.finishedAt = new Date().toISOString(); }
          this.store.release(w.root, id);
        });
      }
    }
    if (workflow.phase === 'AWAITING_DELIVERY_APPROVAL' && snapshot(workflow.root).hash !== workflow.verifiedSnapshot?.hash) {
      workflow = this.store.update(id, 'verification.invalidated', w => { w.phase = 'BLOCKED'; w.resumePhase = 'VERIFYING'; w.blockedReason = 'Workspace changed after verification; the old PASS is invalid.'; w.verifiedSnapshot = undefined; w.lastSnapshot = snapshot(w.root); });
    }
    return this.recoverVerificationEvidence(workflow);
  }
  private recoverVerificationEvidence(workflow: Workflow): Workflow {
    const run = workflow.runs.at(-1);
    if (workflow.phase !== 'BLOCKED' || workflow.pendingStop !== false || workflow.resumePhase !== 'VERIFYING'
      || !workflow.blockedReason?.startsWith('Reported check lacks actual command evidence:') || this.jobs.has(workflow.id)
      || run?.role !== 'verifier' || run.status !== 'SUCCEEDED' || run.lifecycle !== 'termexo-interactive-v1'
      || !run.finishedAt || !run.sessionId || !run.terminalId || !run.commands?.length
      || run.profile.cli !== workflow.plan.verifier.cli || run.profile.model !== workflow.plan.verifier.model
      || !workflow.approvals.some(a => a.kind === 'plan' && a.hash === workflow.plan.hash)) return workflow;
    try {
      const directory = path.join(this.store.directory, 'runs', workflow.id, run.id);
      if (path.resolve(run.directory) !== path.resolve(directory)) return workflow;
      const instructions = readFileSync(path.join(directory, 'interactive-instructions.md'), 'utf8');
      if (!instructions.split(/\r?\n/).includes(`Plan hash: ${workflow.plan.hash}`)) return workflow;
      const report = verificationSchema.parse(JSON.parse(readFileSync(path.join(directory, 'interactive-report.json'), 'utf8')));
      if (report.outcome !== 'PASS') return workflow;
      // These receipts were written by the desktop replay adapter, after native sandbox
      // termination. Do not promote a model-authored PASS or missing/changed evidence.
      for (const [index, command] of run.commands.entries()) {
        const receipt = JSON.parse(readFileSync(path.join(directory, `check-${index}`, 'evidence.json'), 'utf8'));
        if (receipt.command !== command.command || receipt.exitCode !== command.exitCode || receipt.output !== command.output) return workflow;
      }
      const current = snapshot(workflow.root);
      if (current.hash !== workflow.lastSnapshot?.hash) return workflow;
      this.validateVerification(workflow, report, run.commands, 'literal-argv');
      return this.store.update(workflow.id, 'verification.evidence.reconciled', w => {
        w.verification = report; w.verifiedSnapshot = current; w.lastSnapshot = current;
        w.phase = 'AWAITING_DELIVERY_APPROVAL'; w.blockedReason = undefined;
        this.store.release(w.root, w.id);
      }, workflow.revision);
    } catch { return this.store.get(workflow.id); }
  }
  async reconcile(id: string): Promise<Workflow> {
    const before = this.status(id), run = before.runs.at(-1);
    if (before.phase !== 'BLOCKED' || !before.pendingStop || this.jobs.has(id) || !run || !this.runtime.confirmStopped) return before;
    if (!await this.runtime.confirmStopped(run)) return this.status(id);
    // The desktop check is asynchronous: never apply it to a newer run or checkpoint.
    const current = this.store.get(id);
    if (current.revision !== before.revision || current.runs.at(-1)?.id !== run.id || this.jobs.has(id)) return this.status(id);
    return this.store.update(id, 'execution.stop.confirmed', w => {
      w.pendingStop = false;
      w.lastSnapshot = snapshot(w.root);
      const last = w.runs.at(-1)!;
      if (['RUNNING', 'UNKNOWN'].includes(last.status)) { last.status = 'INTERRUPTED'; last.finishedAt = new Date().toISOString(); }
      this.store.release(w.root, id);
    }, before.revision);
  }
  revise(id: string, input: PlanInput, expectedRevision: number): Workflow {
    const data = planInput.parse(input), before = this.status(id);
    if (this.jobs.has(id) || ['BUILDING', 'VERIFYING'].includes(before.phase) || before.pendingStop || terminalPhases.includes(before.phase)) throw new Error('Stop and reconcile the current execution before revising an active plan. Terminal workflows cannot be resumed.');
    this.validateProfiles(data);
    if (snapshot(before.root).hash !== before.lastSnapshot?.hash) throw new Error('Workspace changed outside this workflow; reconcile it before revising.');
    return this.store.update(id, 'plan.revised', w => {
      const version = w.plan.version + 1;
      w.plan = { ...data, version, hash: digest({ ...data, version }) };
      w.phase = 'AWAITING_PLAN_APPROVAL'; w.verification = undefined; w.verifiedSnapshot = undefined; w.repairHash = undefined; w.blockedReason = undefined;
    }, expectedRevision);
  }
  decision(id: string, kind: DecisionKind): DecisionRequest {
    const w = this.status(id);
    const required = { plan: 'AWAITING_PLAN_APPROVAL', repair: 'AWAITING_REPAIR_APPROVAL', delivery: 'AWAITING_DELIVERY_APPROVAL', resume: 'BLOCKED' }[kind];
    if (w.phase !== required || w.pendingStop || this.jobs.has(id)) throw new Error(`Decision ${kind} is not available in ${w.phase}; execution must be confirmed stopped.`);
    if (kind === 'resume' && !w.resumePhase) throw new Error('No safe continuation point is recorded. Revise the plan or end the workflow.');
    const current = snapshot(w.root);
    if (kind !== 'delivery' && current.hash !== w.lastSnapshot?.hash) throw new Error('Workspace changed since the last recorded snapshot. Inspect it before requesting authorization.');
    const hash = kind === 'plan' ? w.plan.hash : kind === 'repair' ? w.repairHash! : kind === 'delivery' ? digest({ plan: w.plan.hash, snapshot: w.verifiedSnapshot?.hash, report: w.verification }) : digest({ plan: w.plan.hash, snapshot: current.hash, resume: w.resumePhase });
    const plan = `${w.plan.title}\n\nGoal: ${w.plan.goal}\n\nAcceptance criteria:\n${w.plan.criteria.map((c, i) => `AC-${i + 1}: ${c}`).join('\n')}\n\nSteps:\n${w.plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nProfiles: implementer=${JSON.stringify(w.plan.implementer)}, verifier=${JSON.stringify(w.plan.verifier)}`;
    const body = kind === 'plan' ? `${plan}\n\nApprove this version to authorize implementation and the following independent verification.` : kind === 'repair' ? `${plan}\n\nAuthorize ONE repair round and re-verification for:\n${w.verification?.issues.join('\n')}\n\n${w.verification?.summary}` : kind === 'delivery' ? `${plan}\n\nAccept delivery?\n${JSON.stringify(w.verification, null, 2)}` : `${plan}\n\nContinue ${w.resumePhase} after confirmed interruption?\n${w.blockedReason}\nCurrent snapshot: ${current.hash}`;
    return { workflowId: id, kind, hash, revision: w.revision, message: `${body}\n\nWorkflow: ${id}\nDecision: ${kind}\nArtifact hash: ${hash}` };
  }
  applyDecision(request: DecisionRequest, accepted: boolean, source: Approval['source']): Workflow {
    if (!accepted) { this.store.event(request.workflowId, 'decision.declined', { kind: request.kind, hash: request.hash }); return this.status(request.workflowId); }
    const current = this.decision(request.workflowId, request.kind);
    if (current.hash !== request.hash || current.revision !== request.revision) throw new Error('Decision is stale; the current artifact must be reviewed again.');
    const id = request.workflowId;
    const result = this.store.update(id, `decision.${request.kind}.accepted`, w => {
      w.approvals.push({ kind: request.kind, hash: request.hash, time: new Date().toISOString(), source });
      if (request.kind === 'delivery') {
        if (w.verification?.outcome !== 'PASS' || w.verifiedSnapshot?.hash !== snapshot(w.root).hash) throw new Error('No current valid PASS exists.');
        w.phase = 'COMPLETED'; return;
      }
      this.store.acquire(w.root, id);
      w.executionOwnerPid = process.pid;
      w.phase = request.kind === 'resume' ? w.resumePhase! : 'BUILDING';
      if (request.kind === 'repair') { w.repairRound += 1; w.repairIssues = [...(w.verification?.issues || [])]; }
      if (w.phase === 'BUILDING') { w.verification = undefined; w.verifiedSnapshot = undefined; }
      w.blockedReason = undefined;
    }, request.revision);
    if (request.kind !== 'delivery') this.launch(id);
    return result;
  }
  private launch(id: string): void {
    if (this.jobs.has(id)) throw new Error('Execution already exists for this workflow.');
    const abort = new AbortController();
    const done = Promise.resolve().then(() => this.execute(id, abort.signal)).finally(() => this.jobs.delete(id));
    this.jobs.set(id, { abort, done });
  }
  private async execute(id: string, signal: AbortSignal): Promise<void> {
    let stoppedConfirmed = true;
    try {
      if (this.store.get(id).phase === 'BUILDING') {
        const w = this.store.get(id), before = snapshot(w.root);
        if (before.hash !== w.lastSnapshot?.hash) throw new Error('Workspace changed before implementation began.');
        const result = await this.worker(id, 'implementer', signal);
        stoppedConfirmed = result.stoppedConfirmed;
        const report = implementationSchema.parse(result.report), after = snapshot(w.root);
        if (signal.aborted) throw new RunFailure('Interrupted after implementation.', true, true);
        const actual = changedFiles(before, after);
        const reported = report.filesChanged.map(file => file.replace(/^\.\//, '')).sort();
        if (JSON.stringify(actual) !== JSON.stringify([...new Set(reported)])) throw new Error(`Implementation report does not match actual changes. Actual: ${actual.join(', ')}`);
        if (after.git !== before.git) throw new Error('Implementation changed Git HEAD or index; reconcile Git state before continuing.');
        this.store.update(id, 'implementation.completed', item => { item.implementation = report; item.lastSnapshot = after; item.phase = 'VERIFYING'; });
      }
      if (signal.aborted) throw new RunFailure('Interrupted before verification.', true, true);
      const w = this.store.get(id), before = snapshot(w.root);
      if (before.hash !== w.lastSnapshot?.hash) throw new Error('Workspace changed before verification began.');
      const result = await this.worker(id, 'verifier', signal);
      stoppedConfirmed = result.stoppedConfirmed;
      const report = verificationSchema.parse(result.report), after = snapshot(w.root);
      if (before.hash !== after.hash) throw new Error('Verifier changed workspace source or Git state; its report is invalid.');
      if (signal.aborted) throw new RunFailure('Interrupted after verification.', true, true);
      this.validateVerification(w, report, result.commands, this.runtime.lifecycle === 'termexo-interactive-v1' ? 'literal-argv' : 'shell');
      this.store.update(id, 'verification.completed', item => {
        item.verification = report; item.lastSnapshot = after;
        if (report.outcome === 'PASS') { item.phase = 'AWAITING_DELIVERY_APPROVAL'; item.verifiedSnapshot = after; }
        else if (report.outcome === 'FAIL') { item.phase = 'AWAITING_REPAIR_APPROVAL'; item.repairHash = digest({ plan: item.plan.hash, report, snapshot: after.hash, round: item.repairRound + 1 }); }
        else { item.phase = 'BLOCKED'; item.resumePhase = 'VERIFYING'; item.blockedReason = report.summary; }
        this.store.release(item.root, id);
      });
    } catch (error) {
      if (error instanceof RunFailure) stoppedConfirmed = error.stoppedConfirmed;
      this.store.update(id, 'execution.blocked', w => {
        w.resumePhase = w.phase === 'BUILDING' ? 'BUILDING' : 'VERIFYING';
        w.phase = 'BLOCKED'; w.blockedReason = errorMessage(error); w.pendingStop = !stoppedConfirmed;
        w.verifiedSnapshot = undefined;
        if (stoppedConfirmed) { w.lastSnapshot = snapshot(w.root); this.store.release(w.root, id); }
      });
    }
  }
  private validateVerification(w: Workflow, report: Verification, commands: { command: string; exitCode: number | null }[], execution: 'shell' | 'literal-argv' = 'shell'): void {
    const expected = w.plan.criteria.map((_, i) => `AC-${i + 1}`).sort();
    if (JSON.stringify(report.criteria.map(c => c.id).sort()) !== JSON.stringify(expected)) throw new Error('Verification must cover every acceptance criterion exactly once.');
    if (report.outcome === 'PASS') {
      if (report.criteria.some(c => c.status !== 'PASS') || report.issues.length || !report.checks.length || report.checks.some(c => c.exitCode !== 0)) throw new Error('PASS contradicts its criteria, issues, or checks.');
      for (const check of report.checks) if (!commands.some(actual => actual.exitCode === check.exitCode && commandEvidenceMatches(actual.command, check.command, execution))) throw new Error(`Reported check lacks actual command evidence: ${check.command}`);
    }
    if (report.outcome === 'FAIL' && (!report.issues.length || !report.criteria.some(c => c.status === 'FAIL'))) throw new Error('FAIL requires a failed criterion and actionable issues.');
  }
  private async worker(id: string, role: 'implementer' | 'verifier', signal: AbortSignal) {
    const w = this.store.get(id), runId = randomUUID(), profile = w.plan[role], directory = path.join(this.store.directory, 'runs', id, runId);
    const record: RunRecord = { id: runId, role, profile, status: 'RUNNING', ownerPid: process.pid, lifecycle: this.runtime.lifecycle, startedAt: new Date().toISOString(), directory };
    this.store.update(id, 'run.started', item => item.runs.push(record));
    const schema = role === 'implementer' ? implementationSchema : verificationSchema;
    const reportSchema = z.toJSONSchema(schema) as Record<string, unknown>;
    const prompt = `You are the One Ring ${role} in a fresh independent session. Work ONLY in this Git workspace. Do not delegate, call One Ring, change Git HEAD/index, commit, push, or alter the approved goal. Do not modify existing unrelated files.\n\nTitle: ${w.plan.title}\nGoal: ${w.plan.goal}\nPlan version: ${w.plan.version}\nPlan hash: ${w.plan.hash}\nAcceptance criteria:\n${w.plan.criteria.map((c, i) => `AC-${i + 1}: ${c}`).join('\n')}\nSteps:\n${w.plan.steps.join('\n')}\n\n${role === 'implementer' ? `Implement the approved plan, meaningful tests and necessary documentation. Report filesChanged as the EXACT workspace-relative paths changed in this run, including new files. Do not stage files. Run relevant checks. ${w.repairRound ? `This is authorized repair round ${w.repairRound}. Fix ONLY these issues and their regression coverage: ${w.repairIssues?.join('; ')}` : ''}` : `Do NOT edit source files. Inspect the real diff against the initial baseline, not just the implementer summary. Execute necessary tests using commands. In checks, list only required validation commands such as tests, linters, and git diff --check, exactly as invoked with actual exit codes. Do NOT include repository discovery or inspection commands (pwd, cat, rg, git status, git log, git show); observations from those belong in criterion evidence instead. A no-match inventory command is not a failed acceptance test. Every AC-* must appear exactly once. Evidence must describe observations. Use FAIL for unmet criteria and INCONCLUSIVE for missing environment/evidence. PASS requires every criterion passed, successful executed checks and no unresolved issues.\nImplementation summary (untrusted claim; verify independently): ${JSON.stringify(w.implementation)}`}\n\nReturn only a report conforming to the supplied JSON Schema.`;
    const executionPrompt = role === 'verifier' ? `${prompt}\n\nHost orchestration record (not implementer-authored): ${JSON.stringify({ workflowId: w.id, planHash: w.plan.hash, approvals: w.approvals, implementationRuns: w.runs.filter(run => run.role === 'implementer').map(run => ({ cli: run.profile.cli, model: run.profile.model || 'CLI configured default', nativeSessionId: run.sessionId, terminalId: run.terminalId, status: run.status, artifactsDirectory: run.directory })) })}. The desktop adapter validates native session identity and the approved OpenCode model before accepting implementation. Inspect native artifacts in the listed run directory when necessary. Human delivery acceptance is a later gate after verification PASS; do not require that future acceptance to already exist in order to verify the implementation.\n\nVerification is read-only: do not create browser profiles, screenshots, test scripts, caches or other artifacts in the project, and do not request permission to bypass this restriction. Run existing checks or perform in-memory checks (for example node -e with a fully quoted argument). If browser execution requires writes or is unavailable in the sandbox, record that limitation honestly instead of escalating or changing files. Prefer a FAIL report for reproducible source defects even when some browser observations remain unavailable.` : prompt;
    try {
      const result = await this.runtime.run({ cwd: w.root, role, profile, prompt: executionPrompt, schema: reportSchema, directory, signal,
        onPid: pid => this.store.update(id, 'run.process.started', item => { item.runs.find(run => run.id === runId)!.childPid = pid; }),
        onSession: session => this.store.update(id, 'run.session.linked', item => { Object.assign(item.runs.find(run => run.id === runId)!, session); }),
        onEvent: event => { const e = event as Record<string, any>; if (e.type === 'item.completed') this.store.event(id, 'run.item.completed', { runId, itemType: e.item?.type }); }
      });
      this.store.update(id, 'run.completed', item => Object.assign(item.runs.find(run => run.id === runId)!, { status: 'SUCCEEDED', sessionId: result.sessionId, commands: result.commands, finishedAt: new Date().toISOString() }));
      return result;
    } catch (error) {
      this.store.update(id, 'run.failed', item => Object.assign(item.runs.find(run => run.id === runId)!, { status: error instanceof RunFailure && !error.stoppedConfirmed ? 'UNKNOWN' : error instanceof RunFailure && error.interrupted ? 'INTERRUPTED' : 'FAILED', error: errorMessage(error), finishedAt: new Date().toISOString() }));
      throw error;
    }
  }
  async stop(id: string): Promise<Workflow> {
    const job = this.jobs.get(id);
    if (!job) {
      const workflow = this.status(id);
      if (['BUILDING', 'VERIFYING'].includes(workflow.phase)) throw new Error('Execution is owned by another MCP instance. Request stopping from the original Codex conversation; the lease cannot be released here.');
      return this.reconcile(id);
    }
    job.abort.abort();
    await job.done;
    return this.status(id);
  }
  async end(id: string, outcome: 'CANCELLED' | 'FAILED'): Promise<Workflow> {
    await this.stop(id);
    const w = this.status(id);
    if (w.pendingStop) throw new Error('Cannot end while process termination is unconfirmed.');
    if (terminalPhases.includes(w.phase)) throw new Error('Workflow is already terminal.');
    return this.store.update(id, 'workflow.ended', item => { item.phase = outcome; this.store.release(item.root, id); });
  }
  async shutdown(): Promise<void> { await Promise.all([...this.jobs.keys()].map(id => this.stop(id))); }
  async wait(id: string): Promise<void> { await this.jobs.get(id)?.done; }
}
