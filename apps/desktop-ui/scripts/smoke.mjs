import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright-core';

const APP_URL = process.env.AGENTDOCK_URL ?? 'http://127.0.0.1:4200';
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

  const terminalBox = await page.locator('.xterm-screen').first().boundingBox();
  if (!terminalBox || terminalBox.width < 100 || terminalBox.height < 100) {
    throw new Error('xterm canvas did not render at a usable size');
  }

  const initialTerminalCount = await page.locator('.terminal-panel').count();
  const toolbar = page.getByRole('toolbar', { name: '工作区工具' });
  await toolbar.getByRole('button', { name: '终端', exact: true }).click();
  await page.getByText(/Shell 3 已创建/).waitFor();

  const updatedTerminalCount = await page.locator('.terminal-panel').count();
  if (updatedTerminalCount !== initialTerminalCount + 1) {
    throw new Error('creating a Shell did not add a terminal panel');
  }

  await toolbar.getByRole('button', { name: 'Agent', exact: true }).click();
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

  await toolbar.getByRole('button', { name: '恢复', exact: true }).click();
  const sessionDialog = page.getByRole('dialog', { name: 'Claude 会话中心' });
  await sessionDialog.waitFor();
  await sessionDialog.getByText('没有匹配的 Claude 会话').waitFor();

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
    path: join(tmpdir(), 'agentdock-desktop.png'),
    fullPage: true,
  });

  await sessionDialog.getByRole('button', { name: '关闭' }).click();
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Claude Code 设置' });
  await settingsDialog.waitFor();
  await settingsDialog.getByRole('button', { name: '模型 Profile' }).click();

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
    path: join(tmpdir(), 'agentdock-compact.png'),
    fullPage: true,
  });

  if (errors.length > 0) {
    throw new Error(`browser errors:\n${errors.join('\n')}`);
  }

  console.log(
    JSON.stringify({
      terminalPanels: updatedTerminalCount,
      terminalCanvas: terminalBox,
      screenshots: [
        join(tmpdir(), 'agentdock-desktop.png'),
        join(tmpdir(), 'agentdock-compact.png'),
      ],
    }),
  );
} finally {
  await browser.close();
}
