import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
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
let page;
let proxyServer;
let temporaryNetworkProfileId;
try {
  await waitForDebugEndpoint(debugUrl, child);
  browser = await chromium.connectOverCDP(debugUrl);
  page = await waitForApplicationPage(browser);

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
        request: {
          terminalId: 'desktop-smoke-codex-resume',
          workspaceId: null,
          sessionId,
          model: null,
        },
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
  const settingsDialog = page.getByRole('dialog', { name: 'Agent 与开发环境设置' });
  await settingsDialog.waitFor();
  await settingsDialog.getByText('Windows Credential Manager', { exact: true }).waitFor();
  const storedAccountProfiles = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('list_account_profiles'),
  );
  if (
    !storedAccountProfiles.some((profile) => profile.id === 'claude-system') ||
    !storedAccountProfiles.some((profile) => profile.id === 'codex-system')
  ) {
    throw new Error('Desktop database did not seed the system account profiles.');
  }
  await settingsDialog.getByRole('button', { name: '登录账号', exact: true }).click();
  await settingsDialog
    .locator('.profile-nav button')
    .filter({ hasText: '系统 Claude 账号' })
    .waitFor();
  await settingsDialog
    .locator('.profile-nav button')
    .filter({ hasText: '系统 ChatGPT 账号' })
    .waitFor();
  const accountProfiles = await page.evaluate(() =>
    Promise.all(
      ['claude-system', 'codex-system'].map((profileId) =>
        window.__TAURI_INTERNALS__.invoke('refresh_account_profile', { profileId }),
      ),
    ),
  );
  if (
    accountProfiles.some((profile) => !profile.diagnostic) ||
    accountProfiles
      .map((profile) => profile.agentType)
      .sort()
      .join(',') !== 'claude,codex'
  ) {
    throw new Error('Desktop account profiles did not resolve isolated CLI login status.');
  }

  proxyServer = createServer((socket) => socket.end());
  await new Promise((resolveListen, rejectListen) => {
    proxyServer.once('error', rejectListen);
    proxyServer.listen(0, '127.0.0.1', resolveListen);
  });
  const proxyAddress = proxyServer.address();
  if (!proxyAddress || typeof proxyAddress === 'string') {
    throw new Error('Desktop smoke proxy did not expose a TCP address.');
  }
  const proxyUrl = `http://127.0.0.1:${proxyAddress.port}`;
  const temporaryNetworkProfileName = `Desktop smoke proxy ${Date.now()}`;

  await settingsDialog.getByRole('button', { name: '网络与 npm', exact: true }).click();
  await settingsDialog.getByRole('button', { name: '新建代理 Profile', exact: true }).click();
  await settingsDialog.getByLabel('名称', { exact: true }).fill(temporaryNetworkProfileName);
  await settingsDialog.getByLabel('HTTPS_PROXY', { exact: true }).fill(proxyUrl);
  await settingsDialog.getByLabel('registry', { exact: true }).fill('https://registry.npmjs.org/');
  await settingsDialog.getByRole('button', { name: '保存代理 Profile', exact: true }).click();
  await settingsDialog.getByText(temporaryNetworkProfileName, { exact: true }).waitFor();

  const storedNetworkProfiles = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('list_network_profiles'),
  );
  const storedNetworkProfile = storedNetworkProfiles.find(
    (profile) => profile.name === temporaryNetworkProfileName,
  );
  if (!storedNetworkProfile) {
    throw new Error('Network profile was not persisted by the settings workflow.');
  }
  temporaryNetworkProfileId = storedNetworkProfile.id;

  await settingsDialog.getByRole('button', { name: '测试连接', exact: true }).click();
  await settingsDialog.getByText('TCP 连通性测试通过', { exact: true }).waitFor();

  const cliPlans = await page.evaluate(
    (workspaceId) =>
      Promise.all(
        ['claude', 'codex'].map((agentType) =>
          window.__TAURI_INTERNALS__.invoke('preview_cli_operation', {
            request: {
              agentType,
              targetVersion: 'latest',
              workspaceId,
              confirmed: false,
            },
          }),
        ),
      ),
    storedNetworkProfile.workspaceId,
  );
  if (
    cliPlans.some(
      (plan) =>
        !plan.ready ||
        !plan.npmPath ||
        !plan.npmVersion ||
        plan.networkProfileId !== temporaryNetworkProfileId,
    )
  ) {
    throw new Error('CLI operation preview did not resolve npm and the workspace network profile.');
  }
  if (
    cliPlans[0].packageSpec !== '@anthropic-ai/claude-code@latest' ||
    cliPlans[1].packageSpec !== '@openai/codex@latest'
  ) {
    throw new Error('CLI operation preview did not use the official packages.');
  }

  await settingsDialog.getByRole('button', { name: 'CLI 安装与升级', exact: true }).click();
  await settingsDialog.getByRole('button', { name: '生成安装计划', exact: true }).click();
  await settingsDialog.getByText('@anthropic-ai/claude-code@latest', { exact: true }).waitFor();
  const desktopExecuteCliButton = settingsDialog.getByRole('button', {
    name: '确认并升级',
    exact: true,
  });
  if (!(await desktopExecuteCliButton.isDisabled())) {
    throw new Error('Desktop CLI mutation became available before explicit confirmation.');
  }

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
      accountProfiles: accountProfiles.map((profile) => ({
        agentType: profile.agentType,
        authenticated: profile.authenticated,
        diagnostic: profile.diagnostic,
      })),
      networkProfileTest: {
        id: temporaryNetworkProfileId,
        target: proxyUrl,
        persisted: true,
        connectivity: 'passed',
      },
      cliManagement: {
        officialPackages: cliPlans.map((plan) => plan.packageSpec),
        npmVersion: cliPlans[0].npmVersion,
        workspaceProxyApplied: cliPlans.every(
          (plan) => plan.networkProfileId === temporaryNetworkProfileId,
        ),
        mutationRequiresConfirmation: true,
      },
    }),
  );
} finally {
  try {
    if (page && temporaryNetworkProfileId) {
      await page
        .evaluate(
          (profileId) => window.__TAURI_INTERNALS__.invoke('delete_network_profile', { profileId }),
          temporaryNetworkProfileId,
        )
        .catch(() => undefined);
    }
    if (proxyServer) {
      await new Promise((resolveClose) => proxyServer.close(resolveClose));
    }
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
