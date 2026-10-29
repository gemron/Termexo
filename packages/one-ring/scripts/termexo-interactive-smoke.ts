// Harmless real-desktop connection test. Does not create/approve a workflow or modify project source.
import path from 'node:path';
import { z } from 'zod';
import { TermexoInteractiveRuntime } from '../src/termexo-runtime.js';
import { implementationSchema } from '../src/protocol.js';

const [executable, database, workspace] = process.argv.slice(2);
if (!executable || !database || !workspace) throw new Error('Usage: termexo-interactive-smoke.ts <termexo.exe> <database> <workspace root>');
const runtime = new TermexoInteractiveRuntime(executable, database, 180000);
const directory = path.resolve('.one-ring/interactive-runtime-smoke', String(Date.now()));
const result = await runtime.run({
  cwd: workspace, directory, role: 'implementer', profile: { cli: 'codex' },
  prompt: 'This is a read-only native CLI routing test, not a coding task. Do not edit source, run shell tools, or stage/commit/push anything. Return a JSON report with summary="NATIVE_INTERACTIVE_RUNTIME_OK", filesChanged=[], checks=[], documentation="No source changes required.", limitations=["Connection smoke test only; no task delivery was accepted."]. Then remain idle and available for user input in this CLI.',
  schema: z.toJSONSchema(implementationSchema), signal: new AbortController().signal,
  onPid: () => {}, onSession: session => console.log(JSON.stringify({ session })),
});
implementationSchema.parse(result.report);
console.log(JSON.stringify({ result, directory, note: 'Native UI and structured-report collection only. Not a workflow approval or delivery.' }));
