import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright-core';

const APP_URL = process.env.TERMEXO_URL ?? process.env.AGENTDOCK_URL ?? 'http://127.0.0.1:4200';
const EDGE_PATH =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await chromium.launch({
  executablePath: EDGE_PATH,
  headless: true,
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.locator('.terminal-panel').first().waitFor();
  if ((await page.title()) !== 'Termexo') {
    throw new Error(`unexpected document title: ${await page.title()}`);
  }
  await page.getByText('Termexo', { exact: true }).first().waitFor();
  const brandLogo = page.locator('.brand-mark img');
  await brandLogo.waitFor();
  if (!(await brandLogo.evaluate((image) => image.complete && image.naturalWidth > 0))) {
    throw new Error('Termexo brand mark did not load');
  }

  const terminalBox = await page.locator('.xterm-screen').first().boundingBox();
  if (!terminalBox || terminalBox.width < 100 || terminalBox.height < 100) {
    throw new Error('xterm canvas did not render at a usable size');
  }

  const initialTerminalCount = await page.locator('.terminal-panel').count();
  const toolbar = page.getByRole('toolbar', { name: '工作区工具' });
  page.once('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
  await toolbar.getByRole('button', { name: '终端', exact: true }).click();
  const createdTerminal = page.locator('.terminal-panel').nth(initialTerminalCount);
  await createdTerminal.waitFor();
  await createdTerminal.getByText('运行中', { exact: true }).waitFor();

  const updatedTerminalCount = await page.locator('.terminal-panel').count();
  if (updatedTerminalCount !== initialTerminalCount + 1) {
    throw new Error('creating a Shell did not add a terminal panel');
  }

  await toolbar.getByRole('button', { name: 'Agent', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
  await page.getByRole('button', { name: /Claude Code/ }).click();
  const launchDialog = page.getByRole('dialog', { name: '新建 Claude 会话' });
  await launchDialog.waitFor();
  if (await launchDialog.getByRole('button', { name: '启动会话' }).isEnabled()) {
    throw new Error('Claude launch must be disabled in browser preview mode');
  }
  await launchDialog.getByRole('button', { name: '关闭' }).click();

  await page.getByTitle('网格布局').click();
  await page.locator('.terminal-grid[data-layout="grid"]').waitFor();
  const layout = await page.locator('.terminal-grid').getAttribute('data-layout');
  if (layout !== 'grid') {
    throw new Error('terminal layout did not switch to grid');
  }

  const gridDimensions = page.locator('.grid-dimensions');
  const columnOutput = gridDimensions.getByLabel('当前网格列数');
  const rowOutput = gridDimensions.getByLabel('当前网格行数');
  const initialColumns = Number(await columnOutput.textContent());
  const initialRows = Number(await rowOutput.textContent());
  await gridDimensions.getByRole('button', { name: '增加网格列数' }).click();
  await columnOutput.filter({ hasText: String(initialColumns + 1) }).waitFor();
  await gridDimensions.getByRole('button', { name: '交换网格行列数' }).click();
  await columnOutput.filter({ hasText: String(initialRows) }).waitFor();
  await rowOutput.filter({ hasText: String(initialColumns + 1) }).waitFor();
  await gridDimensions.getByRole('button', { name: '交换网格行列数' }).click();
  await gridDimensions.getByRole('button', { name: '减少网格列数' }).click();

  await toolbar.getByRole('button', { name: '恢复', exact: true }).click();
  const sessionDialog = page.getByRole('dialog', { name: 'Agent 会话中心' });
  await sessionDialog.waitFor();
  await sessionDialog.getByText('当前工作区没有本地会话').waitFor();

  const desktopDialogBox = await sessionDialog.boundingBox();
  if (
    !desktopDialogBox ||
    desktopDialogBox.x < 0 ||
    desktopDialogBox.y < 0 ||
    desktopDialogBox.x + desktopDialogBox.width > 1440 ||
    desktopDialogBox.y + desktopDialogBox.height > 900
  ) {
    throw new Error('session center is outside the desktop viewport');
  }

  await page.screenshot({
    path: join(tmpdir(), 'termexo-desktop.png'),
    fullPage: true,
  });

  await sessionDialog.locator('.session-footer').getByRole('button', { name: '关闭' }).click();
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Claude Code 设置' });
  await settingsDialog.waitFor();
  await settingsDialog.getByRole('button', { name: '模型 Profile' }).click();
  await settingsDialog.getByRole('button', { name: /新建 Profile/ }).click();
  await settingsDialog.getByLabel('名称', { exact: true }).fill('Smoke Profile');
  await settingsDialog.getByLabel('模型', { exact: true }).fill('sonnet');
  const saveProfileButton = settingsDialog.getByRole('button', { name: '保存 Profile' });
  await saveProfileButton.click();
  await settingsDialog
    .locator('.profile-nav button')
    .filter({ hasText: 'Smoke Profile' })
    .waitFor();
  await saveProfileButton.click();
  const smokeProfileCount = await settingsDialog
    .locator('.profile-nav button')
    .filter({ hasText: 'Smoke Profile' })
    .count();
  if (smokeProfileCount !== 1) {
    throw new Error('saving a new model profile twice created duplicate profiles');
  }

  const compactDialogBox = await settingsDialog.boundingBox();
  if (
    !compactDialogBox ||
    compactDialogBox.x < 0 ||
    compactDialogBox.y < 0 ||
    compactDialogBox.x + compactDialogBox.width > 1024 ||
    compactDialogBox.y + compactDialogBox.height > 720
  ) {
    throw new Error('settings dialog is outside the compact viewport');
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (hasHorizontalOverflow) {
    throw new Error('page has horizontal overflow at the compact viewport');
  }

  await page.screenshot({
    path: join(tmpdir(), 'termexo-compact.png'),
    fullPage: true,
  });

  if (errors.length > 0) {
    throw new Error(`browser errors:\n${errors.join('\n')}`);
  }

  console.log(
    JSON.stringify({
      terminalPanels: updatedTerminalCount,
      terminalCanvas: terminalBox,
      screenshots: [join(tmpdir(), 'termexo-desktop.png'), join(tmpdir(), 'termexo-compact.png')],
    }),
  );
} finally {
  await browser.close();
}
