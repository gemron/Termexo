import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright-core';

if (process.platform !== 'win32') {
  throw new Error('The V0.5 desktop smoke test currently requires Windows and WebView2.');
}

const repositoryRoot = resolve('../..');
const targetDirectory = resolve(
  repositoryRoot,
  process.env.CARGO_TARGET_DIR ?? resolve(repositoryRoot, 'src-tauri', 'target'),
);
const executablePath = resolve(targetDirectory, 'release', 'termexo.exe');
const debugPort = Number(process.env.TERMEXO_V05_DESKTOP_DEBUG_PORT ?? 9777);
const debugUrl = `http://127.0.0.1:${debugPort}`;
const webviewDataDirectory = join(tmpdir(), `termexo-v05-webview-${Date.now()}`);
const child = spawn(executablePath, [], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    WEBVIEW2_USER_DATA_FOLDER: webviewDataDirectory,
  },
  stdio: 'ignore',
  windowsHide: true,
});

let browser;
let page;
let promptAssetId;
let handoffPackageId;

try {
  await waitForDebugEndpoint(debugUrl, child);
  browser = await chromium.connectOverCDP(debugUrl);
  page = await waitForApplicationPage(browser);
  await page.locator('app-root').waitFor();

  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  const workspaces = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke('list_workspaces'),
  );
  const workspace = workspaces[0];
  if (!workspace) throw new Error('No desktop workspace was available for V0.5 verification.');

  const suffix = `${Date.now()}`;
  promptAssetId = `desktop-v05-prompt-${suffix}`;
  handoffPackageId = `desktop-v05-handoff-${suffix}`;
  const result = await page.evaluate(
    async ({ workspaceId, projectPath, promptAssetId, handoffPackageId }) => {
      const now = Date.now();
      await window.__TAURI_INTERNALS__.invoke('save_prompt_asset', {
        input: {
          id: promptAssetId,
          workspaceId,
          terminalId: 'desktop-v05-terminal',
          terminalName: 'V0.5 desktop smoke',
          agentType: 'claude',
          kind: 'draft',
          content: 'V0.5 desktop draft',
          redacted: false,
          favorite: true,
          pinned: true,
          createdAt: now,
          updatedAt: now,
        },
      });
      await window.__TAURI_INTERNALS__.invoke('save_handoff_package', {
        input: {
          id: handoffPackageId,
          workspaceId,
          sourceTerminalId: 'desktop-v05-terminal',
          title: 'V0.5 desktop handoff',
          packageJson: JSON.stringify({ format: 'termexo-handoff', version: 1 }),
          createdAt: now,
          updatedAt: now,
        },
      });
      const [prompts, handoffs, git] = await Promise.all([
        window.__TAURI_INTERNALS__.invoke('list_prompt_assets', { workspaceId }),
        window.__TAURI_INTERNALS__.invoke('list_handoff_packages', { workspaceId }),
        window.__TAURI_INTERNALS__.invoke('collect_git_context', {
          request: { projectPath, maxDiffBytes: 8192 },
        }),
      ]);
      return {
        promptFound: prompts.some(
          (item) => item.id === promptAssetId && item.favorite && item.pinned,
        ),
        handoffFound: handoffs.some((item) => item.id === handoffPackageId),
        git,
      };
    },
    {
      workspaceId: workspace.id,
      projectPath: repositoryRoot,
      promptAssetId,
      handoffPackageId,
    },
  );

  if (!result.promptFound || !result.handoffFound || !result.git.available) {
    throw new Error(`V0.5 Tauri command verification failed: ${JSON.stringify(result)}`);
  }

  await page
    .locator('button[title="打开提示词资产库"], button[title="Open prompt library"]')
    .click();
  const promptDialog = page.locator('.prompt-library');
  await promptDialog.waitFor();
  await promptDialog.locator('header > button').click();

  await page.locator('button[title="打开会话交接"], button[title="Open session handoff"]').click();
  const handoffDialog = page.locator('.handoff-dialog');
  await handoffDialog.waitFor();
  await handoffDialog.locator('header > button').click();

  if (errors.length) throw new Error(`desktop runtime errors: ${errors.join(' | ')}`);
  console.log(
    JSON.stringify({
      version: '0.5.0',
      promptPersistence: result.promptFound,
      handoffPersistence: result.handoffFound,
      gitBranch: result.git.branch,
      dialogs: ['prompt-library', 'handoff'],
    }),
  );
} finally {
  if (page) {
    if (promptAssetId) {
      await page
        .evaluate(
          (assetId) => window.__TAURI_INTERNALS__.invoke('delete_prompt_asset', { assetId }),
          promptAssetId,
        )
        .catch(() => undefined);
    }
    if (handoffPackageId) {
      await page
        .evaluate(
          (packageId) => window.__TAURI_INTERNALS__.invoke('delete_handoff_package', { packageId }),
          handoffPackageId,
        )
        .catch(() => undefined);
    }
    await page
      .evaluate(async () => {
        const [prompts, handoffs, profiles] = await Promise.all([
          window.__TAURI_INTERNALS__.invoke('list_prompt_assets', { workspaceId: null }),
          window.__TAURI_INTERNALS__.invoke('list_handoff_packages', { workspaceId: null }),
          window.__TAURI_INTERNALS__.invoke('list_network_profiles'),
        ]);
        await Promise.all([
          ...prompts
            .filter((item) => item.id.startsWith('desktop-smoke-prompt-'))
            .map((item) =>
              window.__TAURI_INTERNALS__.invoke('delete_prompt_asset', { assetId: item.id }),
            ),
          ...handoffs
            .filter((item) => item.id.startsWith('desktop-smoke-handoff-'))
            .map((item) =>
              window.__TAURI_INTERNALS__.invoke('delete_handoff_package', { packageId: item.id }),
            ),
          ...profiles
            .filter((item) => item.name.startsWith('Desktop smoke proxy '))
            .map((item) =>
              window.__TAURI_INTERNALS__.invoke('delete_network_profile', { profileId: item.id }),
            ),
        ]);
      })
      .catch(() => undefined);
  }
  await browser?.close();
  await stopChildProcess(child);
  await rm(webviewDataDirectory, { recursive: true, force: true }).catch(() => undefined);
}

async function waitForDebugEndpoint(url, process) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Termexo exited before WebView2 became ready (${process.exitCode}).`);
    }
    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) return;
    } catch {
      // WebView2 is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for Termexo WebView2 at ${url}.`);
}

async function waitForApplicationPage(connectedBrowser) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const page = connectedBrowser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) =>
        ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'].some((origin) =>
          candidate.url().startsWith(origin),
        ),
      );
    if (page) return page;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Termexo WebView did not expose an application page.');
}

async function stopChildProcess(process) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  process.kill();
  await Promise.race([
    once(process, 'exit'),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 15_000)),
  ]);
  if (process.exitCode === null && process.signalCode === null) {
    throw new Error('Termexo V0.5 desktop smoke process did not exit cleanly.');
  }
}
