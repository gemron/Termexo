import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright-core';

/**
 * Shared lifecycle for driving the real Termexo desktop build over CDP.
 *
 * Termexo renders inside WebView2, which exposes a Chrome DevTools endpoint when it is started
 * with --remote-debugging-port. Both the smoke tests and the demo recorder need the same
 * "launch the executable, wait for the endpoint, find the application page, shut it down again"
 * sequence, so it lives here instead of being copied into each script.
 */

const DEBUG_PORT_DEFAULT = 9224;
const READINESS_POLL_ATTEMPTS = 60;
const READINESS_POLL_INTERVAL_MS = 250;
const SHUTDOWN_GRACE_MS = 5000;
const APPLICATION_PAGE_ORIGINS = [
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
];

/**
 * Finds the release executable.
 *
 * Depending on whether CARGO_TARGET_DIR was set for a given build, the binary lands either in
 * the vendored target directory or in the default one under src-tauri. Both can hold a binary
 * from a different version, so the most recently built one wins rather than a fixed path —
 * picking the stale one silently records the wrong release.
 */
export function resolveExecutablePath(repositoryRoot) {
  const candidateDirectories = [
    process.env.CARGO_TARGET_DIR,
    resolve(repositoryRoot, 'src-tauri', 'target'),
    resolve(repositoryRoot, '.tooling', 'tauri-target'),
  ].filter(Boolean);

  const candidates = candidateDirectories
    .map((directory) => resolve(repositoryRoot, directory, 'release', 'termexo.exe'))
    .map((path) => ({ path, builtAt: statSyncSafe(path)?.mtimeMs }))
    .filter((candidate) => candidate.builtAt !== undefined)
    .sort((left, right) => right.builtAt - left.builtAt);

  if (candidates.length === 0) {
    throw new Error(
      `No release build found. Run "npm run tauri:build" first (looked in ${candidateDirectories.join(', ')}).`,
    );
  }
  return candidates[0].path;
}

function statSyncSafe(path) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

export function resolveDebugPort() {
  return Number(
    process.env.TERMEXO_DESKTOP_DEBUG_PORT ??
      process.env.AGENTDOCK_DESKTOP_DEBUG_PORT ??
      DEBUG_PORT_DEFAULT,
  );
}

/**
 * Starts termexo.exe and attaches Playwright to its WebView2.
 * Callers must pass the returned handle to stopDesktopSession, ideally from a finally block.
 */
export async function startDesktopSession({
  repositoryRoot,
  executablePath = resolveExecutablePath(repositoryRoot),
  debugPort = resolveDebugPort(),
  environment = {},
} = {}) {
  if (process.platform !== 'win32') {
    throw new Error('Driving the Termexo desktop build requires Windows and WebView2.');
  }

  const debugUrl = `http://127.0.0.1:${debugPort}`;
  const child = spawn(executablePath, [], {
    cwd: repositoryRoot,
    env: {
      ...withoutAgentSessionMarkers(process.env),
      ...environment,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
    stdio: 'ignore',
    windowsHide: true,
  });

  try {
    await waitForDebugEndpoint(debugUrl, child);
    const browser = await chromium.connectOverCDP(debugUrl);
    const page = await waitForApplicationPage(browser);
    return { child, browser, page, debugUrl };
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }
}

/** Closes the CDP connection first so the executable is not killed while Playwright is attached. */
export async function stopDesktopSession({ child, browser }) {
  try {
    await browser?.close();
  } finally {
    await stopChildProcess(child);
  }
}

/**
 * Strips the session markers an Agent CLI sets for its own child processes.
 *
 * When one of these scripts is itself run from inside a Claude Code or Codex session, the
 * launched application inherits those markers and every Agent it starts believes it is a nested
 * child: Claude Code then reports "Transcript saving is off" and writes no transcript, so the
 * session never reaches the session centre. The Agents must start as top-level sessions.
 */
function withoutAgentSessionMarkers(environment) {
  const cleaned = { ...environment };
  for (const name of Object.keys(cleaned)) {
    const upperCaseName = name.toUpperCase();
    if (
      upperCaseName.startsWith('CLAUDE_CODE') ||
      upperCaseName === 'CLAUDECODE' ||
      upperCaseName.startsWith('CODEX_SESSION') ||
      upperCaseName.startsWith('TERMEXO_CODEX_')
    ) {
      delete cleaned[name];
    }
  }
  return cleaned;
}

/** Collects console and page errors so a script can fail on unexpected runtime problems. */
export function collectPageErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function waitForDebugEndpoint(url, process) {
  for (let attempt = 0; attempt < READINESS_POLL_ATTEMPTS; attempt += 1) {
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
    await delay(READINESS_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for Termexo WebView2 at ${url}.`);
}

async function waitForApplicationPage(browser) {
  let observedUrls = [];
  for (let attempt = 0; attempt < READINESS_POLL_ATTEMPTS; attempt += 1) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    observedUrls = pages.map((candidate) => candidate.url());
    const page = pages.find((candidate) =>
      APPLICATION_PAGE_ORIGINS.some((origin) => candidate.url().startsWith(origin)),
    );
    if (page) {
      return page;
    }
    await delay(READINESS_POLL_INTERVAL_MS);
  }
  throw new Error(
    `Termexo WebView did not expose an application page (${observedUrls.join(', ')})`,
  );
}

async function stopChildProcess(process) {
  if (!process || process.exitCode !== null) {
    return;
  }
  process.kill();
  const deadline = Date.now() + SHUTDOWN_GRACE_MS;
  while (process.exitCode === null && Date.now() < deadline) {
    await delay(READINESS_POLL_INTERVAL_MS);
  }
  if (process.exitCode === null) {
    process.kill('SIGKILL');
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
