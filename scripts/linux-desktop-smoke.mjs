import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runRealCodexSmoke } from './linux-real-agent-smoke.mjs';
import { prepareBashMatrix, runBashMatrix } from './linux-bash-matrix.mjs';

assert.equal(process.platform, 'linux', 'This smoke test requires Linux.');
const repository = fileURLToPath(new URL('../', import.meta.url));
const realCodex = process.env.TERMEXO_SMOKE_REAL_AGENT === 'codex';
const bashMatrix = process.env.TERMEXO_SMOKE_BASH_MATRIX === '1';
assert(!(realCodex && bashMatrix), 'Run real agents and recording CLI fixtures separately.');
const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const output = resolve(repository, process.env.TERMEXO_SMOKE_OUTPUT ?? 'validation-results/linux');
const state = await mkdtemp(join(tmpdir(), 'termexo-linux-smoke-'));
const project = join(state, 'project 空格');
await Promise.all([mkdir(output, { recursive: true }), mkdir(project), mkdir(join(state, 'home'))]);
const fixtures = bashMatrix ? await prepareBashMatrix(state, repository) : null;
await writeFile(join(output, 'report.json'), `${JSON.stringify({ status: 'running', state })}\n`);
const port = await freePort();
const nativePort = await freePort();
const executable = resolve(
  repository,
  process.env.TERMEXO_DESKTOP_BINARY ?? 'src-tauri/target/debug/termexo',
);
const driverArgs = ['--port', String(port), '--native-port', String(nativePort)];
if (process.env.WEBKIT_WEBDRIVER) driverArgs.push('--native-driver', process.env.WEBKIT_WEBDRIVER);
const driver = spawn(process.env.TAURI_DRIVER ?? 'tauri-driver', driverArgs, {
  cwd: repository,
  env: {
    ...process.env,
    // Use a fresh application database and agent configuration, keeping the real D-Bus session.
    HOME: join(state, 'home'),
    XDG_DATA_HOME: join(state, 'data'),
    XDG_CONFIG_HOME: join(state, 'config'),
    XDG_CACHE_HOME: join(state, 'cache'),
    SHELL: '',
    TAURI_WEBVIEW_AUTOMATION: 'true',
    ...(realCodex ? { CODEX_HOME: codexHome } : {}),
    ...(fixtures?.environment ?? {}),
  },
  // Own a process group so even a browser stuck before session creation is cleaned up.
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let driverLog = '';
driver.stdout.on('data', (chunk) => {
  driverLog += chunk;
});
driver.stderr.on('data', (chunk) => {
  driverLog += chunk;
});
let driverError;
driver.on('error', (error) => {
  driverError = error;
});
let session;
try {
  await until(async () => {
    if (driverError) throw driverError;
    if (driver.exitCode !== null) throw new Error(`tauri-driver exited: ${driverLog}`);
    try {
      return Boolean(await request('GET', '/status'));
    } catch {
      return false;
    }
  }, 'WebDriver startup');
  session = (
    await request('POST', '/session', {
      capabilities: {
        alwaysMatch: { 'tauri:options': { application: executable } },
      },
    })
  ).sessionId;
  await request('POST', `/session/${session}/timeouts`, { script: 60000 });
  await until(
    () =>
      evaluate(
        () => document.title === 'Termexo' && Boolean(document.querySelector('app-root button')),
      ),
    'application startup',
  );

  const webview = await invoke('get_webview_status');
  assert.equal(webview.supported, true, 'WebKit must not be rejected as an old Chromium runtime');
  assert.equal(webview.major, null);
  const backend = await invoke('get_pty_backend');
  assert.equal(backend.backend, 'unix');
  assert.equal(backend.bundled, false);
  const fonts = await invoke('list_system_fonts');
  assert(fonts.length > 0, 'Fontconfig should list installed families');
  assert(
    fonts.some((font) => font.monospaced),
    'A terminal font should be available',
  );
  const health = await invoke('inspect_one_ring', {
    operation: 'one_ring_doctor',
    workflowId: null,
  });
  assert.equal(health.platform, 'linux');
  const accounts = await invoke('list_account_profiles');
  assert(accounts.some((account) => account.id === 'claude-system'));
  assert(accounts.some((account) => account.id === 'codex-system'));

  const terminalId = 'linux-smoke-terminal';
  const workspace = {
    id: 'linux-smoke-workspace',
    name: 'Linux desktop smoke',
    themeColor: '#58c7a0',
    projectPath: project,
    projectType: 'generic',
    activeBranch: '',
    favorite: false,
    lastOpenedAt: Date.now(),
    layout: 'single',
    gridColumns: 1,
    gridRows: 1,
    commonActions: [],
    terminals: [
      {
        id: terminalId,
        name: 'Linux PTY',
        workingDirectory: project,
        // A Windows workspace must also start with SHELL unset on Linux.
        shell: 'powershell.exe',
        agentType: 'shell',
        status: 'idle',
        model: '',
        branch: '',
        command: "printf 'TERMEXO_LINUX_%s\\n' PTY_READY; pwd",
        nativeSessionId: null,
        profileId: null,
        mcpProfileId: null,
        accountProfileId: null,
      },
    ],
  };
  await invoke('save_workspace', { workspace });
  await request('POST', `/session/${session}/refresh`, {});
  await until(
    () => evaluate(() => Boolean(document.querySelector('.xterm-screen'))),
    'terminal rendering',
  );
  assert.equal(
    await evaluate(() => Boolean(document.querySelector('app-webview-upgrade-dialog'))),
    false,
  );
  await until(
    async () =>
      (await invoke('read_terminal_scrollback', { terminalId })).data.includes(
        'TERMEXO_LINUX_PTY_READY',
      ),
    'PTY startup command',
  );
  let screen = await invoke('read_terminal_scrollback', { terminalId });
  assert(screen.data.includes(project), 'The PTY should use the Unicode project directory');
  await invoke('write_terminal', {
    terminalId,
    data: "printf 'TERMEXO_LINUX_%s\\n' INPUT_OK\r",
  });
  await until(
    async () =>
      (await invoke('read_terminal_scrollback', { terminalId })).data.includes(
        'TERMEXO_LINUX_INPUT_OK',
      ),
    'PTY input',
  );
  const textarea = await request('POST', `/session/${session}/element`, {
    using: 'css selector',
    value: '.xterm-helper-textarea',
  });
  const elementId = textarea['element-6066-11e4-a52e-4f735466cecf'];
  await request('POST', `/session/${session}/element/${elementId}/value`, {
    text: "printf 'TERMEXO_LINUX_%s\\n' UI_INPUT_OK\uE007",
  });
  await until(
    async () =>
      (await invoke('read_terminal_scrollback', { terminalId })).data.includes(
        'TERMEXO_LINUX_UI_INPUT_OK',
      ),
    'keyboard input through xterm',
  );
  await invoke('resize_terminal', {
    terminalId,
    viewerId: 'linux-smoke',
    cols: 100,
    rows: 30,
    claim: true,
  });
  await invoke('write_terminal', {
    terminalId,
    data: 'printf \'TERMEXO_SIZE_%s\\n\' "$(stty size)"\r',
  });
  await until(
    async () =>
      (await invoke('read_terminal_scrollback', { terminalId })).data.includes(
        'TERMEXO_SIZE_30 100',
      ),
    'PTY resize',
  );
  screen = await invoke('read_terminal_scrollback', { terminalId });
  await writeFile(join(output, 'terminal.txt'), screen.data);
  await until(
    () => evaluate(() => !document.querySelector('.terminal-startup')),
    'terminal startup overlay',
  );
  assert.equal(await evaluate(() => Boolean(document.querySelector('.runtime-alert'))), false);
  await writeFile(
    join(output, 'desktop.png'),
    Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
  );

  // Reload the actual webview: SQLite restores the workspace and attaches to the existing PTY.
  await request('POST', `/session/${session}/refresh`, {});
  await until(
    () => evaluate(() => Boolean(document.querySelector('.xterm-screen'))),
    'workspace restore',
  );
  const restored = await invoke('list_workspaces');
  assert.equal(restored.find((item) => item.id === workspace.id)?.projectPath, project);
  assert(
    (await invoke('read_terminal_scrollback', { terminalId })).data.includes(
      'TERMEXO_LINUX_INPUT_OK',
    ),
  );
  await invoke('close_terminal', {
    terminalId,
    preserveRepositoryBaseline: false,
  });
  assert(!(await invoke('list_live_terminals')).some((item) => item.terminalId === terminalId));
  await until(
    () => evaluate(() => Boolean(document.querySelector('.status-indicator[data-status="STOPPED"]'))),
    'intentional terminal close is stopped rather than failed',
  );
  const notification = process.env.TERMEXO_SMOKE_NOTIFICATION === '1'
    ? await invoke('show_desktop_notification', {
        title: 'Termexo Linux notification test',
        body: 'Native notification delivery completed. No action is required.',
      }).then(() => ({ status: 'passed', transport: 'session D-Bus' }))
    : null;
  const realAgent = realCodex
    ? await runRealCodexSmoke({
        invoke,
        until,
        workspace,
        project,
        output,
        screenshot: async () =>
          Buffer.from(await request('GET', `/session/${session}/screenshot`), 'base64'),
      })
    : null;
  const bashCommands = fixtures
    ? await runBashMatrix({ invoke, until, fixtures, project, workspace, output })
    : null;
  const report = {
    status: 'passed',
    executable,
    state,
    graphics: {
      sessionType: process.env.XDG_SESSION_TYPE ?? null,
      backend: process.env.GDK_BACKEND ?? 'auto',
      disableDmaBufRenderer: process.env.WEBKIT_DISABLE_DMABUF_RENDERER ?? null,
    },
    webview,
    backend,
    fontFamilies: fonts.length,
    oneRing: health,
    realAgent,
    bashCommands,
    notification,
    checks: [
      'native WebKit window',
      'Unix PTY backend',
      'Fontconfig families',
      'bundled One Ring runtime',
      'seeded accounts',
      'Windows shell migration with SHELL unset',
      'Unicode working directory',
      'terminal rendering',
      'PTY input/output',
      'keyboard input through xterm',
      'PTY resize',
      'SQLite workspace restore',
      'PTY reattachment after webview reload',
      'PTY close',
      'intentional close reports STOPPED',
    ],
  };
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(
    join(output, 'report.json'),
    `${JSON.stringify({ status: 'failed', state, error: String(error) }, null, 2)}\n`,
  );
  throw error;
} finally {
  if (session) {
    // PTYs create their own process groups, outside the driver's process group.
    // Close them explicitly even when a test fails midway through startup.
    try {
      const terminals = await invoke('list_live_terminals');
      const results = await Promise.allSettled(
        terminals.map(({ terminalId }) =>
          invoke('close_terminal', { terminalId, preserveRepositoryBaseline: false }),
        ),
      );
      for (const result of results) {
        if (result.status === 'rejected') driverLog += `\nPTY cleanup: ${result.reason}`;
      }
    } catch (error) {
      driverLog += `\nPTY cleanup: ${error.message}`;
    }
    await request('DELETE', `/session/${session}`).catch((error) => {
      driverLog += `\nCleanup: ${error.message}`;
    });
  }
  stopDriverGroup('SIGTERM');
  if (driver.pid && driver.exitCode === null && driver.signalCode === null) {
    await Promise.race([once(driver, 'exit'), delay(3000)]);
  }
  // A leader may exit while a browser child ignores SIGTERM.
  stopDriverGroup('SIGKILL');
  await writeFile(join(output, 'driver.log'), driverLog);
}

function stopDriverGroup(signal) {
  if (!driver.pid) return;
  try {
    process.kill(-driver.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const chosen = server.address().port;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return chosen;
}

async function request(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const payload = await response.json();
  if (!response.ok || payload.value?.error)
    throw new Error(`${method} ${path}: ${JSON.stringify(payload)}`);
  return payload.value;
}

async function evaluate(fn, ...args) {
  const result = await request('POST', `/session/${session}/execute/async`, {
    script: `const done = arguments[arguments.length - 1];
      Promise.resolve().then(() => (${fn.toString()})(...Array.from(arguments).slice(0, -1)))
        .then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error) }));`,
    args,
  });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function invoke(command, args = {}) {
  return evaluate(
    (name, payload) => window.__TAURI_INTERNALS__.invoke(name, payload),
    command,
    args,
  );
}

async function until(probe, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${description}. See ${join(output, 'driver.log')}`);
}
