import { chromium } from 'playwright-core';

const APP_URL = process.env.TERMEXO_URL ?? 'http://127.0.0.1:4200';
const EDGE_PATH =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.locator('app-root').waitFor();
  const terminals = await page.evaluate(() => {
    const root = document.querySelector('app-root');
    const app = root && globalThis.ng?.getComponent(root);
    const workspace = app?.state?.activeWorkspace?.();
    if (!app || !workspace) return null;
    const claude = app.state.createTerminal({
      id: 'v05-smoke-claude',
      agentType: 'claude',
      name: 'Claude V0.5 Smoke',
      model: 'sonnet',
      workingDirectory: workspace.projectPath,
    });
    const codex = app.state.createTerminal({
      id: 'v05-smoke-codex',
      agentType: 'codex',
      name: 'Codex V0.5 Smoke',
      model: 'gpt-5.6',
      workingDirectory: workspace.projectPath,
    });
    if (!claude || !codex) return null;
    app.selectTerminal(claude.id);
    app.handleTerminalInput({ terminalId: claude.id, data: '修复多窗口输入定位' });
    app.handleTerminalInput({ terminalId: codex.id, data: '继续 V0.5 开发' });
    app.handleTerminalOutput({
      terminalId: claude.id,
      data: '\u001b[32mCompleted: composition anchor fix\u001b[0m\nTests passed: 129\nNext: ship V0.5',
    });
    return { claudeId: claude.id, codexId: codex.id };
  });
  if (!terminals) throw new Error('could not create V0.5 smoke terminals');
  await page.waitForTimeout(420);

  const promptButton = page.locator(
    'button[title="打开提示词资产库"], button[title="Open prompt library"]',
  );
  await promptButton.click();
  const promptDialog = page.locator('.prompt-library');
  await promptDialog.waitFor();
  const promptTexts = await promptDialog.locator('.asset-text').allInnerTexts();
  if (!promptTexts.includes('修复多窗口输入定位') || !promptTexts.includes('继续 V0.5 开发')) {
    throw new Error(`prompt drafts were not isolated: ${JSON.stringify(promptTexts)}`);
  }
  await promptDialog.locator('input[type="search"]').fill('多窗口');
  if ((await promptDialog.locator('.asset-text').count()) !== 1) {
    throw new Error('prompt search did not narrow the result set');
  }
  await promptDialog.locator('.asset-actions button').nth(1).click();
  const favoriteActive = await promptDialog
    .locator('.asset-actions button')
    .nth(1)
    .evaluate((item) => item.classList.contains('active'));
  if (!favoriteActive) throw new Error('prompt favorite state did not update');
  await promptDialog.locator('header > button').click();

  const handoffButton = page.locator(
    'button[title="打开会话交接"], button[title="Open session handoff"]',
  );
  await handoffButton.click();
  const handoffDialog = page.locator('.handoff-dialog');
  await handoffDialog.waitFor();
  await handoffDialog.locator('.build-card select').selectOption('workspace');
  await handoffDialog.locator('.build-card input[type="number"]').fill('2048');
  await handoffDialog.locator('.build-card button').click();
  await handoffDialog.locator('.package-preview').waitFor();

  const previewText = await handoffDialog.locator('.package-preview').innerText();
  if (
    !previewText.includes('composition anchor fix') ||
    !previewText.includes('修复多窗口输入定位')
  ) {
    throw new Error(`handoff preview is missing task state: ${previewText}`);
  }
  const sourceCount = await handoffDialog.locator('.preview-heading span').innerText();
  const sourceTotal = Number.parseInt(sourceCount, 10);
  if (!Number.isFinite(sourceTotal) || sourceTotal < 2) {
    throw new Error(`workspace handoff did not include both agents: ${sourceCount}`);
  }
  const target = handoffDialog.locator('.send-bar select');
  if ((await target.locator('option').count()) < 2) {
    throw new Error('cross-agent target selector is incomplete');
  }

  await page.setViewportSize({ width: 800, height: 620 });
  await page.waitForTimeout(180);
  const [dialogBox, viewport] = await Promise.all([
    handoffDialog.boundingBox(),
    page.viewportSize(),
  ]);
  if (
    !dialogBox ||
    !viewport ||
    dialogBox.x < 0 ||
    dialogBox.y < 0 ||
    dialogBox.x + dialogBox.width > viewport.width ||
    dialogBox.y + dialogBox.height > viewport.height
  ) {
    throw new Error('handoff dialog overflowed the compact viewport');
  }

  await target.selectOption(terminals.codexId);
  await handoffDialog.locator('.send-bar button').click();
  await handoffDialog.waitFor({ state: 'detached' });
  const activeTerminalId = await page.evaluate(() => {
    const root = document.querySelector('app-root');
    return root && globalThis.ng?.getComponent(root)?.state?.activeTerminal?.()?.id;
  });
  if (activeTerminalId !== terminals.codexId) {
    throw new Error('send-and-continue did not focus the target agent terminal');
  }

  if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
  console.log('V0.5 prompt assets and session handoff smoke test passed.');
} finally {
  await browser.close();
}
