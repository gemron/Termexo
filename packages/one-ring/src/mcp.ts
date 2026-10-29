import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Engine } from './core.js';
import { Store } from './store.js';
import { doctor } from './runtime.js';
import { planInput, errorMessage } from './protocol.js';
import { TermexoInteractiveRuntime } from './termexo-runtime.js';
import { NativeRuntime } from './runtime.js';

export function createMcpServer(engine: Engine): McpServer {
  const server = new McpServer({ name: 'one-ring', version: '0.1.0' });
  const output = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } });
  const wrap = (fn: (...args: any[]) => unknown) => async (...args: any[]) => { try { return output(await fn(...args)); } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: errorMessage(error) }] }; } };
  const id = { workflowId: z.string().uuid() };
  server.registerTool('one_ring_worker_models', { description: 'Read the CLI model catalog for the target workspace. Preserve user-specified choices; propose a concrete implementation model in the plan before approval. Catalog visibility is not an inference entitlement check.', inputSchema: { cli: z.enum(['codex', 'opencode']), root: z.string().min(1) }, annotations: { readOnlyHint: true } }, wrap(({ cli, root }) => {
    if (!engine.runtime.workerModels) throw new Error('Model discovery requires the Termexo interactive runtime.');
    return engine.runtime.workerModels(cli, root);
  }));
  server.registerTool('one_ring_doctor', { description: 'Read installed coding CLI versions and report One Ring support limits. Does not install software, authenticate accounts, or start a coding task.', inputSchema: {}, annotations: { readOnlyHint: true } }, wrap(() => ({
    version: '0.1.0', node: process.version, platform: process.platform, stateDirectory: engine.store.directory,
    workerExecution: { supported: ['linux', 'win32'].includes(process.platform), clis: engine.runtime.lifecycle === 'termexo-interactive-v1' ? ['codex', 'opencode'] : ['codex'], implementers: engine.runtime.lifecycle === 'termexo-interactive-v1' ? ['codex', 'opencode'] : ['codex'], verifiers: ['codex'], lifecycle: engine.runtime.lifecycle || (process.platform === 'win32' ? 'windows-job-v1' : 'posix-process-group'), presentation: engine.runtime.lifecycle === 'termexo-interactive-v1' ? 'native-interactive-cli' : 'background' },
    cli: doctor(engine.runtime.lifecycle === 'termexo-interactive-v1'), hostElicitation: server.server.getClientCapabilities()?.elicitation || null,
    defaults: { implementer: { cli: 'codex' }, verifier: { cli: 'codex' } },
    limits: ['Initially clean Git working trees only.', 'Codex Workers use native interactive Termexo sessions when the desktop bridge is present. Other CLI protocol probes are not execution certification.', 'Human decisions use MCP form elicitation; noninteractive hosts may decline.', 'Worker model is the selected CLI default unless the approved profile explicitly names a model.', 'One Ring is bundled with Termexo; engine, runtime and state paths are managed by the application.']
  })));
  server.registerTool('one_ring_create_plan', { description: 'Record a reviewed goal, criteria, steps and Worker profiles for a clean Git project. Does not start code changes. Ask only for missing requirements before submitting this plan.', inputSchema: { root: z.string().min(1), plan: planInput }, annotations: { destructiveHint: false } }, wrap(({ root, plan }) => engine.create(root, plan, process.env.TERMEXO_COORDINATOR_TERMINAL_ID)));
  server.registerTool('one_ring_revise_plan', { description: 'Replace the complete plan at a waiting checkpoint. Invalidates downstream approvals and reports. Stop execution first; does not edit project code.', inputSchema: { ...id, expectedRevision: z.number().int().positive(), plan: planInput }, annotations: { destructiveHint: false } }, wrap(({ workflowId, plan, expectedRevision }) => engine.revise(workflowId, plan, expectedRevision)));
  server.registerTool('one_ring_status', { description: 'Read persisted workflow status, actual runs, reports and the next required decision. Reconcile a blocked interactive Worker against the desktop process inventory. Checking delivery revalidates the current workspace fingerprint.', inputSchema: id, annotations: { readOnlyHint: true } }, wrap(({ workflowId }) => engine.reconcile(workflowId)));
  server.registerTool('one_ring_wait', { description: 'Wait briefly for a running workflow, then return persisted status. Use while authorized work is running; do not end the host session before the next decision checkpoint.', inputSchema: { ...id, milliseconds: z.number().int().min(100).max(10000).default(5000) }, annotations: { readOnlyHint: true } }, wrap(async ({ workflowId, milliseconds }) => {
    const deadline = Date.now() + milliseconds;
    let workflow = engine.status(workflowId);
    while (['BUILDING', 'VERIFYING'].includes(workflow.phase) && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, Math.min(250, deadline - Date.now()))); workflow = engine.status(workflowId); }
    return workflow;
  }));
  server.registerTool('one_ring_list', { description: 'List recorded workflows without starting or resuming anything.', inputSchema: {}, annotations: { readOnlyHint: true } }, wrap(() => engine.store.list().map(w => ({ id: w.id, title: w.plan.title, root: w.root, phase: w.phase, revision: w.revision, updatedAt: w.updatedAt }))));
  server.registerTool('one_ring_events', { description: 'Read durable workflow events after a sequence number. A successful launch or command is not delivery acceptance.', inputSchema: { ...id, after: z.number().int().nonnegative().default(0) }, annotations: { readOnlyHint: true } }, wrap(({ workflowId, after }) => { engine.store.get(workflowId); return engine.store.events(workflowId, after); }));
  server.registerTool('one_ring_request_decision', {
    description: 'Show the actual versioned plan, repair list, delivery report or continuation point to the user through a host confirmation form. A host-confirmed plan/repair/resume starts the authorized work in background. A declined or unsupported confirmation never starts work. Never invent user approval.',
    inputSchema: { ...id, kind: z.enum(['plan', 'repair', 'delivery', 'resume']) }, annotations: { destructiveHint: false }
  }, wrap(async ({ workflowId, kind }) => {
    if (!server.server.getClientCapabilities()?.elicitation?.form) throw new Error('This host does not advertise form elicitation. Use a supported interactive Codex host; no authorization was recorded.');
    await engine.reconcile(workflowId);
    const request = engine.decision(workflowId, kind);
    const decision = await server.server.elicitInput({ mode: 'form', message: request.message,
      requestedSchema: { type: 'object', properties: { confirmed: { type: 'boolean', title: `Confirm ${kind} for the displayed artifact`, default: false } }, required: ['confirmed'] }
    }, { timeout: 10 * 60_000 });
    const accepted = decision.action === 'accept' && decision.content?.confirmed === true;
    return { accepted, workflow: engine.applyDecision(request, accepted, 'mcp-elicitation') };
  }));
  server.registerTool('one_ring_stop', { description: 'Request stopping an active Worker and wait for termination checks. Keeps partial changes and records. UNKNOWN termination remains blocked.', inputSchema: id, annotations: { destructiveHint: false } }, wrap(({ workflowId }) => engine.stop(workflowId)));
  server.registerTool('one_ring_end', { description: 'End a workflow only when the user explicitly requests cancellation or ending without a passed delivery. Stops current execution first, keeps all files, and does not roll back or commit changes. Terminal workflows cannot be resumed.', inputSchema: { ...id, outcome: z.enum(['CANCELLED', 'FAILED']) }, annotations: { destructiveHint: true } }, wrap(({ workflowId, outcome }) => engine.end(workflowId, outcome)));
  return server;
}

export async function serve(): Promise<void> {
  const store = new Store();
  const runtime = process.env.TERMEXO_EXECUTABLE && process.env.TERMEXO_DATABASE
    ? new TermexoInteractiveRuntime(process.env.TERMEXO_EXECUTABLE, process.env.TERMEXO_DATABASE)
    : new NativeRuntime();
  const engine = new Engine(store, runtime), server = createMcpServer(engine);
  let closing = false;
  const shutdown = async () => { if (closing) return; closing = true; await engine.shutdown(); await server.close(); store.close(); };
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)); });
  process.stdin.once('end', () => { void shutdown(); });
  await server.connect(new StdioServerTransport());
}
