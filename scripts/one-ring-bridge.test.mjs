import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const bridge = readFileSync(
  new URL("../src-tauri/src/one_ring_bridge.mjs", import.meta.url),
  "utf8",
);
async function fixture(body, run) {
  const directory = mkdtempSync(join(tmpdir(), "termexo one ring "));
  const server = join(directory, "fake ' MCP.mjs");
  writeFileSync(
    server,
    `import {createInterface} from 'node:readline';
    const send = (id, result) => console.log(JSON.stringify({jsonrpc:'2.0', id, result}));
    createInterface({input:process.stdin}).on('line', line => {
      const message = JSON.parse(line);
      if (message.method === 'initialize') {
        if (JSON.stringify(message.params.capabilities) !== '{}') process.exit(9);
        send(message.id, {protocolVersion:'2025-06-18', capabilities:{tools:{}}, serverInfo:{name:'fake',version:'1'}});
      }
      if (message.method === 'tools/call') { ${body} }
    });`,
  );
  try {
    await run((operation = "one_ring_list", args = {}) =>
      exec(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          bridge,
          server,
          directory,
          operation,
          JSON.stringify(args),
        ],
        { timeout: 20000 },
      ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("MCP handshake, literal paths with spaces/quotes, and structured workflow results", async () => {
  await fixture(
    `send(message.id, {structuredContent:{result:[{id:'wf', phase:'AWAITING_DELIVERY_APPROVAL', state:process.env.ONE_RING_STATE_DIR}]}});`,
    async (call) => {
      const { stdout } = await call();
      const workflows = JSON.parse(stdout);
      assert.equal(workflows[0].phase, "AWAITING_DELIVERY_APPROVAL");
      assert.match(workflows[0].state, /termexo one ring /);
    },
  );
});
test("preserves workflow id arguments", async () => {
  await fixture(
    `send(message.id, {structuredContent:{result:message.params}});`,
    async (call) => {
      const { stdout } = await call("one_ring_status", {
        workflowId: "opaque-id",
      });
      assert.deepEqual(JSON.parse(stdout), {
        name: "one_ring_status",
        arguments: { workflowId: "opaque-id" },
      });
    },
  );
});
test("rejects write and approval operations before starting the MCP server", async () => {
  await fixture("process.exit(99);", async (call) => {
    for (const operation of [
      "one_ring_create_plan",
      "one_ring_request_decision",
      "one_ring_stop",
    ]) {
      await assert.rejects(
        call(operation),
        (error) =>
          error.code === 1 && /supported inspection/.test(error.stderr),
      );
    }
  });
});
test("surfaces tool errors and malformed server messages", async () => {
  await fixture(
    `send(message.id, {isError:true,content:[{type:'text',text:'database unavailable'}]});`,
    async (call) => {
      await assert.rejects(call(), (error) =>
        /database unavailable/.test(error.stderr),
      );
    },
  );
  await fixture(`console.log('bad-json');`, async (call) => {
    await assert.rejects(call(), (error) => error.code === 1);
  });
});
test("does not pass through server-requested human approval", async () => {
  await fixture(
    `console.log(JSON.stringify({jsonrpc:'2.0',id:72,method:'elicitation/create',params:{}}));
    setTimeout(() => send(message.id, {structuredContent:{result:'inspection-only'}}), 10);`,
    async (call) => {
      const { stdout } = await call();
      assert.equal(JSON.parse(stdout), "inspection-only");
    },
  );
});
