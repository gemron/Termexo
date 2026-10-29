// Uses the exact bridge embedded by Tauri. No model calls and no workflow approvals.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const [pluginDirectory, configuredState] = process.argv.slice(2);
if (!pluginDirectory) {
  console.error(
    "Usage: node scripts/one-ring-smoke.mjs <plugin directory> [existing state directory]",
  );
  process.exit(1);
}
const state = configuredState
  ? resolve(configuredState)
  : mkdtempSync(join(tmpdir(), "termexo-one-ring-smoke-"));
const bridge = readFileSync(
  new URL("../src-tauri/src/one_ring_bridge.mjs", import.meta.url),
  "utf8",
);
const exec = promisify(execFile);
async function inspect(operation, args = {}) {
  const { stdout } = await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      bridge,
      resolve(pluginDirectory, "server/index.mjs"),
      state,
      operation,
      JSON.stringify(args),
    ],
    { timeout: 50000, maxBuffer: 3 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
try {
  const health = await inspect("one_ring_doctor");
  const workflows = await inspect("one_ring_list");
  console.log(
    JSON.stringify(
      {
        version: health.version,
        node: health.node,
        platform: health.platform,
        stateDirectory: health.stateDirectory,
        workflowCount: workflows.length,
      },
      null,
      2,
    ),
  );
  if (workflows.length) {
    const workflow = await inspect("one_ring_status", {
      workflowId: workflows[0].id,
    });
    console.log(
      JSON.stringify(
        {
          id: workflow.id,
          phase: workflow.phase,
          revision: workflow.revision,
          outcome: workflow.verification?.outcome,
        },
        null,
        2,
      ),
    );
  }
} finally {
  if (!configuredState) rmSync(state, { recursive: true, force: true });
}
