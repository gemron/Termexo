import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const APP_URL = process.env.TERMEXO_URL ?? 'http://127.0.0.1:4200';
const EDGE_PATH =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const imageDirectory = resolve(repositoryRoot, 'docs/images');

await mkdir(imageDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE_PATH,
  headless: true,
});

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.locator('.terminal-panel').first().waitFor();

  const toolbar = page.getByRole('toolbar', { name: '工作区工具' });
  await toolbar.getByRole('button', { name: '终端', exact: true }).click();
  const shellPanel = page.locator('.terminal-panel').last();
  await shellPanel.getByText('运行中', { exact: true }).waitFor();
  await page.getByTitle('网格布局').click();
  await page.locator('.terminal-grid[data-layout="grid"]').waitFor();
  await shellPanel.locator('.xterm-screen').click();
  await page.keyboard.type('status');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);

  await page.screenshot({
    path: resolve(imageDirectory, 'termexo-workbench-v0.3.1.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Agent 与开发环境设置' });
  await settingsDialog.waitFor();
  await settingsDialog.getByRole('button', { name: '模型 Profile' }).click();
  await page.screenshot({
    path: resolve(imageDirectory, 'termexo-model-profiles.png'),
    fullPage: true,
  });

  if (errors.length > 0) {
    throw new Error(`browser errors:\n${errors.join('\n')}`);
  }

  console.log(
    JSON.stringify({
      screenshots: [
        resolve(imageDirectory, 'termexo-workbench-v0.3.1.png'),
        resolve(imageDirectory, 'termexo-model-profiles.png'),
      ],
    }),
  );
} finally {
  await browser.close();
}
