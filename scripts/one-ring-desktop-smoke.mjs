import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  copyFile,
  chmod,
  rm,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

assert.equal(process.platform, 'linux');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.env.TERMEXO_ONE_RING_SOURCE;
assert(source, 'Set TERMEXO_ONE_RING_SOURCE to the built One Ring source or release directory');
const real = process.env.TERMEXO_ONE_RING_REAL_TASKS === '1';
const output = resolve(
  root,
  process.env.TERMEXO_ONE_RING_OUTPUT ?? 'validation-results/one-ring-plugin',
);
const state = await mkdtemp(join(tmpdir(), 'termexo-one-ring-'));
const account = join(state, 'codex');
const project = join(state, 'project 空格');
const hostReport = join(state, 'host.json');
await Promise.all([
  mkdir(output, { recursive: true }),
  mkdir(project),
  mkdir(account, { mode: 0o700 }),
  mkdir(join(state, 'home')),
]);
execFileSync('git', ['init', '-q', project]);
const marker = `ONE_RING_${crypto.randomUUID()}`;
await writeFile(join(project, 'fixture.txt'), `${marker}\n`);
let driver;
let dev;
let session;
let driverLog = '';
let port;
let result;
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

async function until(probe, description, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await probe()) return;
    await delay(200);
  }
  throw new Error(`Timed out: ${description}`);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function request(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  if (!response.ok || data.value?.error) throw new Error(`${path}: ${JSON.stringify(data.value)}`);
  return data.value;
}
async function evaluate(fn, ...args) {
  const result = await request('POST', `/session/${session}/execute/async`, {
    script: `const done=arguments[arguments.length-1];Promise.resolve().then(()=>(${fn.toString()})(...Array.from(arguments).slice(0,-1))).then(value=>done({value}),error=>done({error:String(error)}));`,
    args,
  });
  if (result.error) throw new Error(result.error);
  return result.value;
}
const invoke = (name, args = {}) =>
  evaluate((name, args) => window.__TAURI_INTERNALS__.invoke(name, args), name, args);
const screenshot = async (name) =>
  writeFile(
    join(output, name),
    Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
  );
function records() {
  const db = new DatabaseSync(
    join(state, 'data/dev.agentdock.desktop/plugins/one-ring/state/sessions.sqlite'),
    { readOnly: true },
  );
  try {
    return db
      .prepare('SELECT data FROM sessions')
      .all()
      .map((row) => JSON.parse(row.data));
  } finally {
    db.close();
  }
}
async function readHost() {
  const data = await readFile(hostReport, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (data?.error) throw new Error(data.error);
  return data;
}
async function saveSettings(enabled) {
  await evaluate(() => document.querySelector('[data-testid="settings-open"]').click());
  await until(
    () =>
      evaluate(() =>
        [...document.querySelectorAll('.settings-tabs button')].some((b) =>
          /Codex (插件|plugins)/.test(b.textContent),
        ),
      ),
    'settings tab',
  );
  await evaluate(() =>
    [...document.querySelectorAll('.settings-tabs button')]
      .find((b) => /Codex (插件|plugins)/.test(b.textContent))
      .click(),
  );
  await until(
    () =>
      evaluate(() => !!document.querySelector('app-codex-plugins-panel fieldset:not(:disabled)')),
    'plugin settings',
  );
  await evaluate(
    (source, node, enabled) => {
      const panel = document.querySelector('app-codex-plugins-panel');
      const fields = panel.querySelectorAll('input:not([type="checkbox"])');
      [source, node].forEach((value, index) => {
        fields[index].value = value;
        fields[index].dispatchEvent(new Event('input', { bubbles: true }));
      });
      const checkbox = panel.querySelector('input[type="checkbox"]');
      checkbox.checked = enabled;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      panel.querySelector('.btn-primary').click();
    },
    source,
    process.execPath,
    enabled,
  );
  await until(async () => {
    const status = await invoke('get_one_ring_plugin');
    return status.settings.enabled === enabled && (!enabled || status.ready);
  }, 'settings persisted');
  if (enabled) await screenshot('settings.png');
  await evaluate(() => document.querySelector('app-agent-settings-dialog header button').click());
  await until(
    () => evaluate(() => !document.querySelector('app-agent-settings-dialog')),
    'settings closed',
  );
}

try {
  if (real) {
    const original = process.env.CODEX_HOME ?? join(homedir(), '.codex');
    let keep = true;
    const config = (await readFile(join(original, 'config.toml'), 'utf8'))
      .split('\n')
      .filter((line) => {
        if (/^\s*\[/.test(line))
          keep = !/^\s*\[\[?(mcp_servers|plugins|marketplaces)([.\] ]|$)/.test(line);
        return keep;
      })
      .join('\n');
    await writeFile(join(account, 'config.toml'), config, { mode: 0o600 });
    await copyFile(join(original, 'auth.json'), join(account, 'auth.json'));
    await chmod(join(account, 'auth.json'), 0o600);
  }
  const serving = await fetch('http://127.0.0.1:4200', { signal: AbortSignal.timeout(1000) })
    .then((response) => response.ok)
    .catch(() => false);
  if (!serving) {
    dev = spawn('npm', ['run', 'dev'], {
      cwd: root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    dev.stdout.on('data', () => {});
    dev.stderr.on('data', () => {});
    await until(
      () =>
        fetch('http://127.0.0.1:4200', { signal: AbortSignal.timeout(1000) })
          .then((r) => r.ok)
          .catch(() => false),
      'frontend server',
      60000,
    );
  }
  port = await freePort();
  const args = ['--port', String(port), '--native-port', String(await freePort())];
  if (process.env.WEBKIT_WEBDRIVER) args.push('--native-driver', process.env.WEBKIT_WEBDRIVER);
  driver = spawn(process.env.TAURI_DRIVER ?? 'tauri-driver', args, {
    cwd: root,
    env: {
      ...process.env,
      HOME: join(state, 'home'),
      CODEX_HOME: account,
      XDG_DATA_HOME: join(state, 'data'),
      XDG_CONFIG_HOME: join(state, 'config'),
      XDG_CACHE_HOME: join(state, 'cache'),
      TAURI_WEBVIEW_AUTOMATION: 'true',
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  driver.stdout.on('data', (data) => {
    driverLog += data;
  });
  driver.stderr.on('data', (data) => {
    driverLog += data;
  });
  let driverError;
  driver.on('error', (error) => {
    driverError = error;
  });
  await until(async () => {
    if (driverError) throw driverError;
    if (driver.exitCode !== null) throw new Error(driverLog);
    return request('GET', '/status')
      .then(() => true)
      .catch(() => false);
  }, 'WebDriver');
  session = (
    await request('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          'tauri:options': {
            application: resolve(
              root,
              process.env.TERMEXO_DESKTOP_BINARY ?? 'src-tauri/target/debug/termexo',
            ),
          },
        },
      },
    })
  ).sessionId;
  await request('POST', `/session/${session}/timeouts`, { script: 60000 });
  await until(
    () => evaluate(() => !!document.querySelector('[data-testid="settings-open"]')),
    'desktop UI',
  );
  await evaluate(() => localStorage.setItem('termexo.language', 'zh-CN'));
  const workspace = {
    id: 'ring-test-workspace',
    name: 'One Ring 自动测试',
    projectPath: project,
    projectType: 'generic',
    activeBranch: 'master',
    favorite: false,
    lastOpenedAt: Date.now(),
    layout: 'columns',
    gridColumns: 2,
    gridRows: 1,
    commonActions: [],
    terminals: [],
  };
  await invoke('save_workspace', { workspace });
  await request('POST', `/session/${session}/refresh`, {});
  await until(
    () => evaluate(() => !!document.querySelector('[data-testid="settings-open"]')),
    'workspace UI',
  );
  await saveSettings(true);
  console.log('One Ring: native settings UI enabled the plugin.');
  const hostId = 'one-ring-test-host';
  const fixture = fileURLToPath(new URL('./one-ring-test-host.mjs', import.meta.url));
  const command =
    'exec ' +
    [process.execPath, fixture, hostReport, project, source, real ? 'real' : 'idle']
      .map(quote)
      .join(' ');
  const host = {
    id: hostId,
    name: 'One Ring 自动测试 Host',
    workingDirectory: project,
    shell: '/bin/bash',
    agentType: 'codex',
    status: 'STARTING',
    model: 'CLI native',
    branch: 'master',
    command,
    accountProfileId: 'codex-system',
    profileId: '__termexo_cli_native__',
  };
  await invoke('save_workspace', { workspace: { ...workspace, terminals: [host] } });
  const start = {
    terminalId: hostId,
    shell: '/bin/bash',
    workingDirectory: project,
    command,
    agentType: 'codex',
    workspaceId: workspace.id,
    accountProfileId: 'codex-system',
    profileId: '__termexo_cli_native__',
    cols: 120,
    rows: 35,
  };
  // Exercise concurrent attachments: neither preparation may revoke the active Host token.
  await Promise.all([
    invoke('create_terminal', { request: start }),
    invoke('create_terminal', { request: start }),
  ]);
  await until(
    async () => {
      const value = await readHost();
      if (value?.phase === 'close_worker') return true;
      const screen = await invoke('read_terminal_scrollback', { terminalId: hostId });
      await writeFile(join(output, 'host.txt'), screen.data, { mode: 0o600 });
      return false;
    },
    real ? 'two real Worker tasks' : 'Worker startup',
    real ? 240000 : 60000,
  );
  const first = (await readHost()).first;
  assert.equal(first.terminal.launcher, 'termexo');
  assert.match(first.terminal.tty, /^\/dev\/pts\//);
  assert.equal(await readFile(join(project, 'fixture.txt'), 'utf8'), `${marker}\n`);
  assert.deepEqual((await readdir(project)).sort(), ['.git', 'fixture.txt']);
  let current = (await invoke('list_workspaces')).find((w) => w.id === workspace.id);
  const worker = current.terminals.find((t) => t.name === first.terminal.title);
  assert(worker, 'Worker tab must be present in the Host workspace');
  await screenshot('worker.png');
  await invoke('close_terminal', { terminalId: worker.id, preserveRepositoryBaseline: false });
  await until(
    async () => (await readHost())?.phase === 'close_host',
    'workspace released and second Worker opened',
    60000,
  );
  const second = (await readHost()).second;
  await invoke('close_terminal', { terminalId: hostId, preserveRepositoryBaseline: false });
  await until(
    () => records().find((r) => r.id === second.id)?.status === 'CLOSED',
    'Host disconnection stops its Worker',
    15000,
  );
  assert(
    records()
      .filter((r) => [first.id, second.id].includes(r.id))
      .every((r) => r.status === 'CLOSED'),
  );
  for (const record of [first, second])
    assert.throws(() => process.kill(record.terminal.pid, 0), 'Worker TUI must stop');
  await saveSettings(false);
  const disabledReport = join(state, 'disabled.json');
  const disabledId = 'one-ring-disabled-host';
  const disabledCommand =
    'exec ' +
    [process.execPath, fixture, disabledReport, project, source, 'disabled'].map(quote).join(' ');
  await invoke('create_terminal', {
    request: { ...start, terminalId: disabledId, command: disabledCommand },
  });
  await until(
    () =>
      readFile(disabledReport, 'utf8')
        .then(JSON.parse)
        .then((v) => {
          if (v.error) throw new Error(v.error);
          return v.phase === 'disabled';
        })
        .catch((error) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        }),
    'disabled plugin overrides',
  );
  result = {
    status: 'passed',
    realModelTasks: real ? 2 : 0,
    source,
    state,
    first,
    secondWorkerId: second.id,
    finalStatuses: records().map(({ id, status }) => ({ id, status })),
    checks: [
      'native settings UI',
      'native Codex plugin installation',
      'concurrent Host attachment',
      'real embedded Codex TUI',
      ...(real ? ['file command evidence', 'same-session memory'] : []),
      'Worker tab close',
      'workspace reservation release',
      'Host disconnection cleanup',
      'plugin disable',
    ],
  };
  await writeFile(join(output, 'report.json'), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      { status: result.status, realModelTasks: result.realModelTasks, checks: result.checks },
      null,
      2,
    ),
  );
} catch (error) {
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify({ status: 'failed', state, error: String(error) }, null, 2),
  );
  if (session) await screenshot('failure.png').catch(() => {});
  throw error;
} finally {
  if (session) {
    try {
      for (const { terminalId } of await invoke('list_live_terminals'))
        await invoke('close_terminal', { terminalId, preserveRepositoryBaseline: false });
    } catch (error) {
      driverLog += `\nPTY cleanup: ${error}`;
    }
    await request('DELETE', `/session/${session}`).catch((error) => {
      driverLog += `\nWindow cleanup: ${error}`;
    });
  }
  for (const process of [driver, dev])
    if (process?.pid)
      try {
        globalThis.process.kill(-process.pid, 'SIGTERM');
      } catch {
        /* Already exited. */
      }
  await Promise.all(
    ['auth.json', 'config.toml'].map((name) => rm(join(account, name), { force: true })),
  );
  await writeFile(join(output, 'driver.log'), driverLog);
}
