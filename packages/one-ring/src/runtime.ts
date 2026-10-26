import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { CommandEvidence, Profile, RunRecord } from './protocol.js';
import { windowsCodexExecutable, windowsWorkerCommand } from './windows-worker.js';

export type RunRequest = { cwd: string; role: 'implementer' | 'verifier'; profile: Profile; prompt: string; schema: Record<string, unknown>; directory: string; signal: AbortSignal; onPid: (pid: number) => void; onSession?: (session: { terminalId: string; sessionId?: string }) => void; onEvent?: (event: unknown) => void };
export type RunResult = { report: unknown; sessionId?: string; commands: CommandEvidence[]; stoppedConfirmed: boolean };
export interface Runtime { readonly lifecycle?: string; run(request: RunRequest): Promise<RunResult>; confirmStopped?(run: RunRecord): Promise<boolean>; workerModels?(cli: 'codex' | 'opencode', root: string): Promise<unknown>; }
export class RunFailure extends Error { constructor(message: string, readonly stoppedConfirmed: boolean, readonly interrupted = false) { super(message); } }

export function workerArguments(request: Omit<RunRequest, 'signal' | 'onPid'>): string[] {
  if (request.profile.cli !== 'codex') throw new Error(`${request.profile.cli}: execution is not yet certified. Use a certified Codex profile; doctor reports other CLI discovery separately.`);
  return ['--ask-for-approval', 'never', '--disable', 'plugins', '--disable', 'hooks', '--disable', 'multi_agent',
    '-c', 'mcp_servers={}',
    'exec', '--json', '--ephemeral', '--sandbox', request.role === 'verifier' ? 'read-only' : 'workspace-write',
    '--output-schema', path.join(request.directory, 'schema.json'), '--output-last-message', path.join(request.directory, 'answer.json'),
    ...(request.profile.model ? ['--model', request.profile.model] : []), '-'];
}
export class NativeRuntime implements Runtime {
  readonly lifecycle = process.platform === 'win32' ? 'windows-job-v1' : 'posix-process-group';
  constructor(readonly timeoutMs = 15 * 60_000, readonly executable = 'codex', readonly prefixArguments: string[] = []) {}
  async run(request: RunRequest): Promise<RunResult> {
    mkdirSync(request.directory, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(request.directory, 'schema.json'), JSON.stringify(request.schema, null, 2));
    writeFileSync(path.join(request.directory, 'prompt.txt'), request.prompt, { mode: 0o600 });
    if (request.signal.aborted) throw new RunFailure('Interrupted before process creation.', true, true);
    const args = [...this.prefixArguments, ...workerArguments(request)];
    const env = { ...process.env };
    // Keep the CLI's authentication/routing environment. Independent identity is
    // established by the NEW thread.started event, not by deleting host metadata.
    delete env.ONE_RING_STATE_DIR;
    let executable = this.executable;
    if (process.platform === 'win32') {
      try { executable = windowsCodexExecutable(executable); }
      catch (error) { throw new RunFailure((error as Error).message, true); }
    }
    const windows = process.platform === 'win32' ? windowsWorkerCommand(executable, args, request.cwd, request.directory) : undefined;
    const child = spawn(windows?.executable || executable, windows?.args || args, { cwd: request.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true, shell: false });
    const commands: CommandEvidence[] = [];
    let sessionId: string | undefined, pending = '', bytes = 0, timedOut = false, cancelled = false, overflow = false, turnCompleted = false, turnFailed = false;
    const decoder = new StringDecoder('utf8');
    let protocolError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const alive = (): boolean => {
      if (!child.pid) return false;
      if (process.platform === 'win32') return child.exitCode === null;
      try { process.kill(-child.pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
    };
    const kill = (force: boolean): void => {
      if (!child.pid) return;
      try {
        if (windows) {
          if (force) spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
          else windows.stop();
        }
        else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch { /* Exit may race cancellation. Closure is checked separately. */ }
    };
    const stop = (): void => { cancelled = true; kill(false); killTimer ??= setTimeout(() => kill(true), windows ? 10000 : 1500); };
    const parse = (line: string): void => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as Record<string, any>;
        if (event.type === 'thread.started') sessionId = event.thread_id;
        if (event.type === 'turn.completed') turnCompleted = true;
        if (event.type === 'turn.failed') turnFailed = true;
        if (event.type === 'item.completed' && event.item?.type === 'command_execution') commands.push({ command: String(event.item.command), exitCode: event.item.exit_code ?? null, output: String(event.item.aggregated_output || '').slice(-24000) });
        request.onEvent?.(event);
      } catch { protocolError = new Error('Worker emitted malformed JSONL.'); stop(); }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { overflow = true; stop(); return; }
      try { appendFileSync(path.join(request.directory, 'events.jsonl'), chunk); } catch { protocolError = new Error('Cannot persist Worker event evidence.'); stop(); return; }
      pending += decoder.write(chunk);
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) !== -1) { parse(pending.slice(0, boundary)); pending = pending.slice(boundary + 1); }
    });
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) { overflow = true; stop(); return; } try { appendFileSync(path.join(request.directory, 'stderr.txt'), chunk); } catch { protocolError = new Error('Cannot persist Worker stderr evidence.'); stop(); } });
    child.stdin.on('error', () => { /* An early CLI exit can close stdin. */ });
    if (child.pid) { try { request.onPid(child.pid); } catch { protocolError = new Error('Cannot persist Worker process identity.'); stop(); } }
    request.signal.addEventListener('abort', stop, { once: true });
    if (request.signal.aborted) stop();
    child.stdin.end(request.prompt);
    const timeout = setTimeout(() => { timedOut = true; stop(); }, this.timeoutMs);
    let spawnError: Error | undefined;
    child.on('error', error => { spawnError = error; });
    const exitCode = await new Promise<number | null>(resolve => child.on('close', resolve));
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', stop);
    pending += decoder.end();
    if (pending.trim()) parse(pending);
    if (alive()) {
      kill(false);
      await new Promise(resolve => setTimeout(resolve, 100));
      if (alive()) { kill(true); await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (killTimer) clearTimeout(killTimer);
    const stoppedConfirmed = windows ? windows.stopped() || !!spawnError : !alive();
    if (!stoppedConfirmed) throw new RunFailure('Cannot confirm all worker processes stopped; workspace lease retained.', false, cancelled);
    if (spawnError) throw new RunFailure(spawnError.message, true);
    if (protocolError) throw new RunFailure(protocolError.message, true);
    if (overflow) throw new RunFailure('Worker output exceeded 16 MiB; run stopped.', true);
    if (timedOut) throw new RunFailure('Worker execution timed out.', true);
    if (cancelled) throw new RunFailure('Worker was interrupted.', true, true);
    if (exitCode !== 0) throw new RunFailure(`Worker exited with code ${exitCode}. Inspect the run stderr artifact.`, true);
    if (!turnCompleted || turnFailed || !sessionId) throw new RunFailure('Worker stream lacks a successful terminal turn or independent session identity.', true);
    let report: unknown;
    try { report = JSON.parse(readFileSync(path.join(request.directory, 'answer.json'), 'utf8')); } catch { throw new RunFailure('Worker did not produce a valid final JSON report.', true); }
    return { report, sessionId, commands, stoppedConfirmed };
  }
}

export function doctor(interactive = false): unknown[] {
  return ['codex', 'opencode'].map(cli => {
    let executable = cli;
    if (cli === 'opencode' && process.platform === 'win32') executable = process.env.TERMEXO_OPENCODE_PATH || path.join(process.env.APPDATA || '', 'npm/node_modules/@opencode/cli/bin/opencode.exe');
    try { if (process.platform === 'win32' && cli === 'codex') executable = windowsCodexExecutable(cli); } catch { /* Report detection failure below. */ }
    const result = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    return { cli, installed: !result.error && result.status === 0, version: result.status === 0 ? result.stdout.trim().slice(0, 300) : null,
      execution: cli === 'opencode' && interactive ? 'native-interactive-v2; implementer only; explicit provider/model and independent Codex verification required' : cli === 'codex' ? process.platform === 'linux' ? 'preview-linux; validated with 0.163.0' : process.platform === 'win32' ? 'preview-windows-job-v1; native Codex sandbox required' : 'not-certified' : 'requires-Termexo-interactive-runtime',
      error: result.error ? (result.error as NodeJS.ErrnoException).code || result.error.message : result.status === 0 ? null : 'Version command failed' };
  });
}
