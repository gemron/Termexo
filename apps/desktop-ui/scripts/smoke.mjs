import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright-core';

const APP_URL = process.env.AGENTDOCK_URL ?? 'http://127.0.0.1:4200';
const EDGE_PATH =
  process.env.EDGE_PATH ??
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

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
  await toolbar.getByRole('button', { name: 'Agent', exact: true }).click();
  await page.getByRole('button', { name: /Claude Code/ }).click();
  await page.getByText(/Claude Code 3 已创建/).waitFor();

  const updatedTerminalCount = await page.locator('.terminal-panel').count();
  if (updatedTerminalCount !== initialTerminalCount + 1) {
    throw new Error('creating an Agent did not add a terminal panel');
  }

  await page.getByTitle('网格布局').click();
  await page.locator('.terminal-grid[data-layout="grid"]').waitFor();
  const layout = await page.locator('.terminal-grid').getAttribute('data-layout');
  if (layout !== 'grid') {
    throw new Error('terminal layout did not switch to grid');
  }

  await toolbar.getByRole('button', { name: '切换模型', exact: true }).click();
  const modelDialog = page.getByRole('dialog', {
    name: '切换 Workspace 模型',
  });
  await modelDialog.waitFor();
  await page.screenshot({
    path: join(tmpdir(), 'agentdock-desktop.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 1024, height: 720 });
  await modelDialog.getByRole('button', { name: '关闭' }).click();
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
