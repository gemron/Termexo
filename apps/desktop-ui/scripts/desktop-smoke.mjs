import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';

import { chromium } from 'playwright-core';

if (process.platform !== 'win32') {
  throw new Error('The desktop smoke test currently requires Windows and WebView2.');
}

const repositoryRoot = resolve('../..');
const executablePath = resolve(repositoryRoot, 'src-tauri', 'target', 'release', 'termexo.exe');
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
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().startsWith('http://tauri.localhost'));
  if (!page) {
    throw new Error('Termexo WebView did not expose an application page.');
  }

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
  const backendInstallation = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('detect_claude'),
  );
  if (!backendInstallation.healthy) {
    throw new Error(`Claude backend detection failed: ${backendInstallation.diagnostic}`);
  }

  await toolbar.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByRole('button', { name: /Claude Code/ }).click();
  const launchDialog = page.getByRole('dialog', { name: '新建 Claude 会话' });
  await launchDialog.waitFor();
  await launchDialog.getByText('Claude Code 可用', { exact: true }).waitFor();
  const diagnostic = await launchDialog.locator('.installation-line').innerText();
  if (!diagnostic.includes('Claude Code 可用')) {
    throw new Error(`Claude detection failed in the desktop runtime: ${diagnostic}`);
  }
  if (!(await launchDialog.getByRole('button', { name: '启动会话' }).isEnabled())) {
    throw new Error('Claude launch remained disabled after successful desktop detection.');
  }
  await launchDialog.getByRole('button', { name: '关闭' }).click();

  const initialTerminalCount = await page.locator('.terminal-panel').count();
  await toolbar.getByRole('button', { name: '终端', exact: true }).click();
  const shellPanel = page.locator('.terminal-panel').last();
  await shellPanel.getByText('运行中', { exact: true }).waitFor();
  await shellPanel.getByRole('button', { name: '关闭终端' }).click();
  await page.waitForFunction(
    (expectedCount) => document.querySelectorAll('.terminal-panel').length === expectedCount,
    initialTerminalCount,
  );

  await toolbar.getByRole('button', { name: '恢复', exact: true }).click();
  const sessionDialog = page.getByRole('dialog', { name: 'Claude 会话中心' });
  await sessionDialog.waitFor();
  const connectionStatus = await sessionDialog.locator('.installation-badge').innerText();
  if (connectionStatus.includes('未连接')) {
    throw new Error('Session center did not receive the desktop Claude installation state.');
  }
  await sessionDialog.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Claude Code 设置' });
  await settingsDialog.waitFor();
  await settingsDialog.getByText('Windows Credential Manager', { exact: true }).waitFor();

  if (errors.length > 0) {
    throw new Error(`desktop runtime errors:\n${errors.join('\n')}`);
  }

  console.log(
    JSON.stringify({
      claudeDiagnostic: diagnostic.replace(/\s+/g, ' ').trim(),
      executablePath: backendInstallation.executablePath,
      terminalStatus: 'RUNNING',
      sessionConnection: connectionStatus.trim(),
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
