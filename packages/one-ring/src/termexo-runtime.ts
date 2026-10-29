import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { RunFailure, type Runtime, type RunRequest, type RunResult } from './runtime.js';
import { windowsCodexExecutable, windowsWorkerCommand } from './windows-worker.js';
import type { CommandEvidence, RunRecord } from './protocol.js';
import { readOpenCodeReport } from './opencode-evidence.js';
import { verificationArgv } from './command-evidence.js';
export { verificationArgv } from './command-evidence.js';

type Session = { terminalId: string; sessionId?: string; transcriptPath?: string; evidence?: unknown; live: boolean; status: string; stoppedConfirmed?: boolean };
const EVIDENCE_LIMIT_BYTES = 16 * 1024 * 1024;
const SESSION_POLL_MS = 1000;
const VALIDATION_TIMEOUT_MS = 120000;
export function readInteractiveReport(transcript: string): { completed: boolean; interrupted: boolean; report?: unknown; takenOver?: boolean } {
  let completed = false, interrupted = false, report: unknown, turns = 0;
  for (const line of transcript.split('\n')) {
    let record: any; try { record = JSON.parse(line); } catch { continue; }
    if (record.type !== 'event_msg') continue;
    const event = record.payload;
    if (event?.type === 'task_started') { turns++; completed = false; report = undefined; interrupted = false; }
    if (event?.type === 'turn_aborted') interrupted = true;
    if (event?.type === 'task_complete') {
      completed = true;
      const message = String(event.last_agent_message || '').trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
      try { report = JSON.parse(message); } catch { /* A natural-language reply is not structured delivery. */ }
    }
  }
  return { completed, interrupted, report, ...(turns > 1 ? { takenOver: true } : {}) };
}

// Verification evidence is replayed in the CLI's native read-only sandbox. A model's final
// JSON or code-tool console output is never treated as proof that a command actually succeeded.
export class TermexoInteractiveRuntime implements Runtime {
  readonly lifecycle = 'termexo-interactive-v1';
  constructor(readonly executable: string, readonly database: string, readonly timeoutMs = 30 * 60_000, readonly clientFactory: () => Client = () => new Client({ name: 'one-ring-interactive-runtime', version: '0.1.0' })) {}
  async workerModels(cli: 'codex' | 'opencode', root: string): Promise<unknown> {
    const client = this.clientFactory();
    try {
      await client.connect(new StdioClientTransport({ command: this.executable, args: ['mcp-proxy', '--database', this.database, '--one-ring'], stderr: 'pipe' }));
      const unpack = (result: any) => { if (result.isError) throw new Error(result.content?.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('\n') || 'Cannot read the desktop CLI model catalog.'); return JSON.parse(result.content.find((item: any) => item.type === 'text').text); };
      const workspaces = unpack(await client.callTool({ name: 'workspace_list', arguments: {} })) as { id: string; projectPath: string }[];
      const normalize = (value: string) => path.resolve(value).replace(/\\/g, '/').toLowerCase();
      const workspace = workspaces.find(item => normalize(item.projectPath) === normalize(root));
      if (!workspace) throw new Error('No matching Termexo workspace exists.');
      return unpack(await client.callTool({ name: 'agent_worker_models', arguments: { workspaceId: workspace.id, cli,
        ...(cli === 'codex' && process.env.TERMEXO_ACCOUNT_PROFILE_ID ? { accountProfileId: process.env.TERMEXO_ACCOUNT_PROFILE_ID } : {}) } }));
    } finally { await client.close(); }
  }
  async confirmStopped(run: RunRecord): Promise<boolean> {
    if (run.lifecycle !== this.lifecycle || !run.terminalId) return false;
    const client = this.clientFactory();
    const transport = new StdioClientTransport({ command: this.executable, args: ['mcp-proxy', '--database', this.database, '--one-ring'], stderr: 'pipe' });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'agent_session_inspect', arguments: { terminalId: run.terminalId } });
      if (result.isError) return false;
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content.find((item: any) => item.type === 'text') as { type: 'text'; text: string } | undefined;
      if (!text || text.type !== 'text') return false;
      const state = JSON.parse(text.text) as Session;
      // Missing UI rows, a Ready prompt and an MCP failure are not stop receipts.
      return state.terminalId === run.terminalId && state.live === false && state.stoppedConfirmed === true
        && (!state.sessionId || !run.sessionId || state.sessionId === run.sessionId);
    } catch { return false; }
    finally { await client.close().catch(() => {}); }
  }
  async run(request: RunRequest): Promise<RunResult> {
    if (!['codex', 'opencode'].includes(request.profile.cli) || request.role === 'verifier' && request.profile.cli !== 'codex') throw new RunFailure('Use a Codex verifier and a Codex or OpenCode implementer.', true);
    if (request.signal.aborted) throw new RunFailure('Interrupted before interactive session creation.', true, true);
    mkdirSync(request.directory, { recursive: true });
    const instructions = path.join(request.directory, 'interactive-instructions.md');
    writeFileSync(instructions, `${request.prompt}\n\nYou are running as a real interactive ${request.profile.cli} session managed by Termexo. The user can inspect or take over this session. Do not invoke One Ring or desktop orchestration tools. Complete the task and end your turn with ONLY the following JSON report schema (no prose or markdown). Keep this CLI open for user interaction after returning the report. List validation commands in literal argv form (such as node --test or git diff --check), without shell wrappers or chained commands. The adapter independently replays these checks in a read-only sandbox.\n\n${JSON.stringify(request.schema, null, 2)}\n`);
    const transport = new StdioClientTransport({ command: this.executable, args: ['mcp-proxy', '--database', this.database, '--one-ring'], stderr: 'pipe' });
    const client = this.clientFactory();
    let terminalId: string | undefined;
    let dispatchAttempted = false;
    let sessionQuiescent = false;
    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw new Error(JSON.stringify(result.content));
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content.find((item: any) => item.type === 'text') as { text: string } | undefined;
      if (!text) throw new Error('Desktop returned no tool result.');
      return JSON.parse(text.text) as T;
    };
    try {
      await client.connect(transport);
      const workspaces = await call<{ id: string; projectPath: string }[]>('workspace_list', {});
      const normalize = (value: string) => path.resolve(value).replace(/\\/g, '/').toLowerCase();
      const workspace = workspaces.find(item => normalize(item.projectPath) === normalize(request.cwd));
      if (!workspace) throw new RunFailure('No matching Termexo workspace exists for this Worker.', true);
      if (request.signal.aborted) throw new RunFailure('Interrupted before interactive session dispatch.', true, true);
      dispatchAttempted = true;
      const terminal = await call<{ id: string }>('agent_session_start', {
        workspaceId: workspace.id, role: request.role, cli: request.profile.cli, instructionsPath: instructions,
        name: `One Ring · ${request.role === 'implementer' ? '实施者' : '验证者'}`,
        workingDirectory: request.cwd,
        ...(request.profile.model ? { model: request.profile.model } : {}),
        ...(process.env.TERMEXO_ACCOUNT_PROFILE_ID ? { accountProfileId: process.env.TERMEXO_ACCOUNT_PROFILE_ID } : {}),
      });
      terminalId = terminal.id;
      request.onSession?.({ terminalId });
      let linkedSession: string | undefined;
      writeFileSync(path.join(request.directory, 'termexo-session.json'), JSON.stringify({ terminalId, workspaceId: workspace.id }));
      const deadline = Date.now() + this.timeoutMs;
      while (Date.now() < deadline) {
        if (request.signal.aborted) {
          await call('terminal_write', { terminalId, data: '\u001b', submit: false });
          // Keep the user's interactive CLI. Esc is a stop request, not proof of quiescence.
          throw new RunFailure('Interactive Worker stop requested; confirm the session is quiescent before continuing.', false, true);
        }
        const state = await call<Session>('agent_session_inspect', { terminalId });
        if (!state.live) throw new RunFailure('The interactive Worker window was closed; inspect partial changes before continuing.', false, true);
        if ((state.transcriptPath || state.evidence) && state.sessionId) {
          if (linkedSession !== state.sessionId) { linkedSession = state.sessionId; request.onSession?.({ terminalId, sessionId: state.sessionId }); }
          const transcript = state.transcriptPath ? readFileSync(state.transcriptPath, 'utf8') : JSON.stringify(state.evidence);
          if (Buffer.byteLength(transcript) > EVIDENCE_LIMIT_BYTES) throw new RunFailure('Interactive transcript exceeded the evidence size limit.', false);
          const result = request.profile.cli === 'opencode' ? readOpenCodeReport(state.evidence, state.sessionId, request.profile.model) : readInteractiveReport(transcript);
          if ('failure' in result && result.failure) throw new RunFailure(`OpenCode Worker failed: ${result.failure}`, true);
          if (result.takenOver) throw new RunFailure('The interactive session received another user turn. Keep it available for manual takeover; re-authorize workflow continuation separately.', false, true);
          if (result.interrupted) throw new RunFailure('The user interrupted the Worker. Review the live session before resuming.', false, true);
          if (result.completed && !result.report && ['IDLE', 'COMPLETED'].includes(state.status)) throw new RunFailure('The interactive Worker ended without a structured report; its CLI remains open for inspection.', true);
          if (result.completed && result.report && (request.profile.cli === 'opencode' || ['IDLE', 'COMPLETED', 'WAITING_INPUT'].includes(state.status))) {
            sessionQuiescent = true;
            writeFileSync(path.join(request.directory, 'interactive-report.json'), JSON.stringify(result.report, null, 2));
            if (state.evidence) writeFileSync(path.join(request.directory, 'interactive-native-evidence.json'), JSON.stringify(state.evidence, null, 2));
            const commands: CommandEvidence[] = [];
            if (request.role === 'verifier') {
              const report = result.report as { outcome?: string; checks?: { command: string }[] };
              // Only a prospective PASS needs independent replay to justify delivery.
              // Preserve native FAIL/INCONCLUSIVE findings without rerunning a failed browser
              // command that may require writes or an unavailable local environment.
              if (report.outcome === 'PASS') for (const check of report.checks || []) commands.push(await this.verify(check.command, request, commands.length));
            }
            return { report: result.report, commands, stoppedConfirmed: true, sessionId: state.sessionId };
          }
        }
        await new Promise(resolve => setTimeout(resolve, SESSION_POLL_MS));
      }
      throw new RunFailure('Interactive Worker timed out; its window remains available for user inspection.', false);
    } catch (error) {
      if (error instanceof RunFailure) throw error;
      throw new RunFailure((error as Error).message, sessionQuiescent || !dispatchAttempted);
    } finally { await client.close(); }
  }

  private async verify(command: string, request: RunRequest, index: number): Promise<CommandEvidence> {
    const argv = verificationArgv(command);
    const program = argv.shift()!;
    const directory = path.join(request.directory, `check-${index}`); mkdirSync(directory);
    const sandboxArgs = ['sandbox', '-C', request.cwd, '-P', ':read-only', '--', program === 'node' ? process.execPath : program, ...argv];
    const job = windowsWorkerCommand(windowsCodexExecutable(), sandboxArgs, request.cwd, directory);
    const child = spawn(job.executable, job.args, { cwd: request.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', bytes = 0, timedOut = false;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    const collect = (chunk: string) => { bytes += Buffer.byteLength(chunk); output = (output + chunk).slice(-24000); if (bytes > EVIDENCE_LIMIT_BYTES) job.stop(); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const stop = () => job.stop(); request.signal.addEventListener('abort', stop, { once: true });
    const timeout = setTimeout(() => { timedOut = true; stop(); }, VALIDATION_TIMEOUT_MS);
    let code: number | null;
    try { code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
    finally { clearTimeout(timeout); request.signal.removeEventListener('abort', stop); }
    if (!job.stopped()) throw new RunFailure('Cannot confirm verification sandbox termination.', false);
    if (request.signal.aborted) throw new RunFailure('Verification interrupted.', true, true);
    if (timedOut || bytes > EVIDENCE_LIMIT_BYTES) throw new RunFailure('Verification command exceeded its time or output limit.', true);
    const evidence = { command, exitCode: code, output };
    writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
    return evidence;
  }
}
