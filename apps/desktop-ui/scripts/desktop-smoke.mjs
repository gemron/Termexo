import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

import { chromium } from 'playwright-core';

if (process.platform !== 'win32') {
  throw new Error('The desktop smoke test currently requires Windows and WebView2.');
}

const repositoryRoot = resolve('../..');
const targetDirectory = resolve(
  repositoryRoot,
  process.env.CARGO_TARGET_DIR ?? resolve(repositoryRoot, '.tooling', 'tauri-target'),
);
const executablePath = resolve(targetDirectory, 'release', 'termexo.exe');
const debugPort = Number(
  process.env.TERMEXO_DESKTOP_DEBUG_PORT ?? process.env.AGENTDOCK_DESKTOP_DEBUG_PORT ?? 9224,
);
const debugUrl = `http://127.0.0.1:${debugPort}`;
const child = spawn(executablePath, [], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
  },
  stdio: 'ignore',
  windowsHide: true,
});

let browser;
try {
  await waitForDebugEndpoint(debugUrl, child);
  browser = await chromium.connectOverCDP(debugUrl);
  const page = await waitForApplicationPage(browser);

  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  if ((await page.title()) !== 'Termexo') {
    throw new Error(`unexpected document title: ${await page.title()}`);
  }
  await page.getByText('Termexo', { exact: true }).first().waitFor();
  const toolbar = page.getByRole('toolbar', { name: '工作区工具' });
  await toolbar.waitFor();
  const [backendInstallation, codexInstallation, codexSessions] = await page.evaluate(() =>
    Promise.all([
      window.__TAURI_INTERNALS__.invoke('detect_claude'),
      window.__TAURI_INTERNALS__.invoke('detect_codex'),
      window.__TAURI_INTERNALS__.invoke('scan_codex_sessions', { projectPath: null }),
    ]),
  );
  if (!backendInstallation.healthy) {
    throw new Error(`Claude backend detection failed: ${backendInstallation.diagnostic}`);
  }
  if (!codexInstallation.healthy) {
    throw new Error(`Codex backend detection failed: ${codexInstallation.diagnostic}`);
  }
  if (codexSessions.length === 0) {
    throw new Error('Codex session scan did not find any local rollouts.');
  }
  const codexResumeLaunch = await page.evaluate(
    (sessionId) =>
      window.__TAURI_INTERNALS__.invoke('prepare_codex_launch', {
        request: { sessionId, model: null },
      }),
    codexSessions[0].nativeSessionId,
  );
  if (!codexResumeLaunch.command.includes(' resume ')) {
    throw new Error('Codex resume launch command was not prepared correctly.');
  }

  await toolbar.getByRole('button', { name: '恢复', exact: true }).click();
  const sessionDialog = page.getByRole('dialog', { name: 'Agent 会话中心' });
  await sessionDialog.waitFor();
  const connectionStatuses = await sessionDialog.locator('.agent-health').allInnerTexts();
  if (connectionStatuses.some((status) => status.includes('未连接'))) {
    throw new Error('Session center did not receive all desktop Agent installation states.');
  }
  await sessionDialog.locator('.session-footer').getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Claude Code 设置' });
  await settingsDialog.waitFor();
  await settingsDialog.getByText('Windows Credential Manager', { exact: true }).waitFor();

  if (errors.length > 0) {
    throw new Error(`desktop runtime errors:\n${errors.join('\n')}`);
  }

  console.log(
    JSON.stringify({
      claudeDiagnostic: backendInstallation.diagnostic,
      codexDiagnostic: codexInstallation.diagnostic,
      codexSessionCount: codexSessions.length,
      codexVersion: codexInstallation.version,
      codexExecutablePath: codexResumeLaunch.executablePath,
      executablePath: backendInstallation.executablePath,
      sessionConnections: connectionStatuses.map((status) => status.trim()),
    }),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await stopChildProcess(child);
  }
}

async function waitForDebugEndpoint(url, process) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Termexo exited before WebView2 became ready (${process.exitCode}).`);
    }
    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // WebView2 is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for Termexo WebView2 at ${url}.`);
}

async function waitForApplicationPage(browser) {
  let observedUrls = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    observedUrls = pages.map((candidate) => candidate.url());
    const page = pages.find((candidate) =>
      ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'].some((origin) =>
        candidate.url().startsWith(origin),
      ),
    );
    if (page) {
      return page;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(
    `Termexo WebView did not expose an application page (${observedUrls.join(', ')})`,
  );
}

async function stopChildProcess(process) {
  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }

  process.kill();
  await Promise.race([
    once(process, 'exit'),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 15_000)),
  ]);
  if (process.exitCode === null && process.signalCode === null) {
    throw new Error('Termexo desktop smoke process did not exit cleanly.');
  }
}
