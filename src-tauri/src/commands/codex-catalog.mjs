import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

let executable = process.argv[1];
if (process.platform === 'win32' && /\.cmd$/i.test(executable)) {
  const packageFile = path.join(path.dirname(executable), 'node_modules/@openai/codex/package.json');
  const require = createRequire(packageFile);
  const platform = path.dirname(require.resolve(`@openai/codex-win32-${process.arch}/package.json`));
  const target = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  executable = ['bin', 'codex'].map(leaf => path.join(platform, `vendor/${target}-pc-windows-msvc/${leaf}/codex.exe`)).find(existsSync);
  if (!executable) throw new Error('Cannot locate the installed native Codex executable');
}
const child = spawn(executable, ['--disable', 'plugins', '--disable', 'hooks', 'app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let sequence = 0, bytes = 0, failed = false;
const pending = new Map();
const timer = setTimeout(() => finish(new Error('Codex model discovery timed out')), 18000);
function finish(error) {
  clearTimeout(timer);
  if (error && !failed) { failed = true; console.error(error.message); process.exitCode = 1; }
  for (const item of pending.values()) item.reject(error || new Error('Catalog client closed'));
  pending.clear(); child.stdin.destroy(); child.kill();
}
child.on('error', finish);
child.stdin.on('error', finish);
child.stderr.on('data', () => {}); // Never forward account/config diagnostics to the UI.
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  bytes += Buffer.byteLength(line);
  if (bytes > 4 * 1024 * 1024) { finish(new Error('Codex model response exceeded its size limit')); return; }
  let value; try { value = JSON.parse(line); } catch { return; }
  const item = pending.get(value.id); if (!item) return;
  pending.delete(value.id);
  if (value.error) item.reject(new Error(value.error.message || 'Codex catalog query failed'));
  else item.resolve(value.result);
});
child.on('exit', () => { if (pending.size) finish(new Error('Codex exited before returning its model catalog')); });
function rpc(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n'); });
}
try {
  await rpc('initialize', { clientInfo: { name: 'termexo-model-picker', title: 'Termexo model picker', version: '1' }, capabilities: {} });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const models = []; let cursor;
  do {
    const page = await rpc('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
    models.push(...page.data); cursor = page.nextCursor;
    if (models.length > 1000) throw new Error('Codex model catalog exceeds the display limit');
  } while (cursor);
  const config = await rpc('config/read', { includeLayers: false });
  process.stdout.write(JSON.stringify({ source: 'codex-app-server', configuredDefault: config.config?.model || null,
    models: models.map(item => ({ id: item.model || item.id, displayName: item.displayName || item.model || item.id, isDefault: item.isDefault === true,
      supportedReasoningEfforts: (item.supportedReasoningEfforts || []).map(e => e.reasoningEffort), defaultReasoningEffort: item.defaultReasoningEffort })) }));
  finish();
} catch (error) { finish(error); }
