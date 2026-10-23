// Short-lived, read-only MCP client. The Codex coordinator owns execution and approval.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname } from "node:path";

const [server, stateDirectory, operation, encodedArgs] = process.argv.slice(1);
const allowed = new Set([
  "one_ring_doctor",
  "one_ring_list",
  "one_ring_status",
]);
if (
  Number(process.versions.node.split(".")[0]) < 24 ||
  !allowed.has(operation)
) {
  console.error(
    "One Ring requires Node.js 24+ and a supported inspection operation.",
  );
  process.exit(1);
}
const child = spawn(process.execPath, [server], {
  cwd: dirname(server),
  env: { ...process.env, ONE_RING_STATE_DIR: stateDirectory },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  shell: false,
});
let finished = false;
let bytes = 0;
let diagnostic = "";
// doctor can probe four CLIs, each with its own ten-second deadline.
const deadline = setTimeout(
  () => finish(new Error("One Ring MCP inspection timed out.")),
  45000,
);
function finish(error, result) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  child.stdin.end();
  child.kill();
  if (error)
    console.error(error.message + (diagnostic ? `\n${diagnostic}` : ""));
  else process.stdout.write(JSON.stringify(result));
  process.exitCode = error ? 1 : 0;
}
function send(message) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
}
child.on("error", (error) => finish(error));
child.stdin.on("error", (error) => finish(error));
child.on("exit", (code) => {
  if (!finished) finish(new Error(`One Ring MCP exited (${code}).`));
});
child.stderr.on("data", (data) => {
  diagnostic = (diagnostic + data).slice(-4096);
});
child.stdout.on("data", (data) => {
  bytes += data.length;
  if (bytes > 2 * 1024 * 1024)
    finish(new Error("One Ring MCP response exceeds the inspection limit."));
});
createInterface({ input: child.stdout }).on("line", (line) => {
  if (finished) return;
  try {
    const message = JSON.parse(line);
    if (message.error)
      throw new Error(message.error.message || "MCP protocol error");
    if (message.id === 1) {
      if (!message.result?.capabilities?.tools)
        throw new Error("The server does not advertise MCP tools.");
      send({ method: "notifications/initialized" });
      send({
        id: 2,
        method: "tools/call",
        params: { name: operation, arguments: JSON.parse(encodedArgs) },
      });
    } else if (message.id === 2) {
      if (message.result?.isError)
        throw new Error(
          message.result.content?.map((item) => item.text || "").join("\n") ||
            "One Ring tool failed",
        );
      const result = message.result?.structuredContent;
      if (!result || !Object.hasOwn(result, "result"))
        throw new Error("Unexpected One Ring result format.");
      finish(null, result.result);
    } else if (message.id !== undefined && message.method) {
      send({
        id: message.id,
        error: {
          code: -32601,
          message: "The inspection client cannot approve or execute requests.",
        },
      });
    }
  } catch (error) {
    finish(error);
  }
});
send({
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "termexo-one-ring-inspector", version: "0.1.0" },
  },
});
