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
  const assertWithinViewport = async (locator, label) => {
    await locator.waitFor();
    await page.waitForTimeout(180);
    const [box, viewport, visualStyle] = await Promise.all([
      locator.boundingBox(),
      page.viewportSize(),
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          opacity: Number(style.opacity),
        };
      }),
    ]);
    if (
      !box ||
      !viewport ||
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > viewport.width ||
      box.y + box.height > viewport.height
    ) {
      throw new Error(`${label} is outside the viewport`);
    }
    if (
      visualStyle.opacity < 0.99 ||
      visualStyle.backgroundColor === 'transparent' ||
      visualStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
    ) {
      throw new Error(`${label} has a transparent or incomplete visual surface`);
    }
    return box;
  };
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.locator('.terminal-panel').first().waitFor();
  const runningStatus = page
    .locator('.terminal-panel .status-indicator[data-status="RUNNING"]')
    .first();
  await runningStatus.waitFor();
  const runningStatusVisual = await runningStatus.evaluate((status) => {
    const light = status.querySelector('.status-light');
    const title = status.nextElementSibling;
    const label = title?.nextElementSibling;
    return {
      lightBeforeLabel:
        light instanceof HTMLElement &&
        title?.tagName === 'STRONG' &&
        label instanceof HTMLElement &&
        label.classList.contains('status-label'),
      animationName: light ? getComputedStyle(light).animationName : 'none',
      labelBackground: label ? getComputedStyle(label).backgroundColor : '',
    };
  });
  if (
    !runningStatusVisual.lightBeforeLabel ||
    runningStatusVisual.animationName === 'none' ||
    !['transparent', 'rgba(0, 0, 0, 0)'].includes(runningStatusVisual.labelBackground)
  ) {
    throw new Error(
      `running terminal status light is incomplete: ${JSON.stringify(runningStatusVisual)}`,
    );
  }
  if ((await page.title()) !== 'Termexo') {
    throw new Error(`unexpected document title: ${await page.title()}`);
  }
  await page.getByText('Termexo', { exact: true }).first().waitFor();
  const brandLogo = page.locator('.brand-mark img');
  await brandLogo.waitFor();
  if (!(await brandLogo.evaluate((image) => image.complete && image.naturalWidth > 0))) {
    throw new Error('Termexo brand mark did not load');
  }
  const uiIntegration = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const themeRoot = document.querySelector('app-root');
    const lucideIcons = [...document.querySelectorAll('app-icon svg')];
    const shellStyle = themeRoot ? getComputedStyle(themeRoot) : null;
    const bodyStyle = getComputedStyle(document.body);
    return {
      documentTheme: document.documentElement.getAttribute('data-theme'),
      theme: themeRoot?.getAttribute('data-theme'),
      bodyColor: bodyStyle.color,
      bodyBackgroundColor: bodyStyle.backgroundColor,
      primaryColor: shellStyle?.getPropertyValue('--color-primary').trim() ?? '',
      radiusBox: shellStyle?.getPropertyValue('--radius-box').trim() ?? '',
      fontFamily: bodyStyle.fontFamily,
      fontSize: Number.parseFloat(bodyStyle.fontSize),
      daisyButtonCount: document.querySelectorAll('.btn').length,
      renderedLucideCount: lucideIcons.filter((icon) => icon.childElementCount > 0).length,
    };
  });
  if (
    uiIntegration.documentTheme !== 'termexo' ||
    uiIntegration.theme !== 'termexo' ||
    uiIntegration.bodyColor === uiIntegration.bodyBackgroundColor ||
    uiIntegration.bodyColor === 'rgb(0, 0, 0)' ||
    uiIntegration.bodyBackgroundColor === 'rgba(0, 0, 0, 0)' ||
    !uiIntegration.primaryColor ||
    !uiIntegration.radiusBox ||
    !uiIntegration.fontFamily.includes('Microsoft YaHei UI') ||
    uiIntegration.fontSize < 13 ||
    uiIntegration.daisyButtonCount === 0 ||
    uiIntegration.renderedLucideCount === 0
  ) {
    throw new Error(
      `DaisyUI or Lucide integration is incomplete: ${JSON.stringify(uiIntegration)}`,
    );
  }

  const terminalBox = await page.locator('.xterm-screen').first().boundingBox();
  if (!terminalBox || terminalBox.width < 100 || terminalBox.height < 100) {
    throw new Error('xterm canvas did not render at a usable size');
  }

  await page.getByRole('button', { name: '新建工作区', exact: true }).click();
  const createWorkspaceDialog = page.getByRole('dialog', { name: '新建工作区' });
  await createWorkspaceDialog.waitFor();
  await assertWithinViewport(createWorkspaceDialog, 'create workspace dialog');
  page.once('dialog', (dialog) => dialog.accept('D:\\smoke-workspace'));
  await createWorkspaceDialog.getByRole('button', { name: '选择目录', exact: true }).click();
  await createWorkspaceDialog.getByLabel('工作空间项目目录').waitFor({ state: 'visible' });
  if (
    (await createWorkspaceDialog.getByLabel('工作空间项目目录').inputValue()) !==
    'D:\\smoke-workspace'
  ) {
    throw new Error('workspace directory picker did not populate the project path');
  }
  if ((await createWorkspaceDialog.locator('input').first().inputValue()) !== 'smoke-workspace') {
    throw new Error('workspace directory picker did not infer the workspace name');
  }
  await createWorkspaceDialog
    .getByText('名称', { exact: true })
    .locator('..')
    .locator('input')
    .fill('Smoke Workspace');
  await createWorkspaceDialog.getByRole('button', { name: '创建工作区', exact: true }).click();

  const smokeWorkspaceEntry = page
    .locator('.workspace-entry')
    .filter({ hasText: 'Smoke Workspace' });
  await smokeWorkspaceEntry.waitFor();
  await smokeWorkspaceEntry.hover();
  await smokeWorkspaceEntry.getByRole('button', { name: '删除工作空间', exact: true }).click();
  const deleteWorkspaceDialog = page.getByRole('dialog', { name: '删除工作空间' });
  await deleteWorkspaceDialog.waitFor();
  await assertWithinViewport(deleteWorkspaceDialog, 'delete workspace dialog');
  await deleteWorkspaceDialog.getByRole('button', { name: '删除工作空间', exact: true }).click();
  await smokeWorkspaceEntry.waitFor({ state: 'detached' });

  const firstWorkspaceEntry = page.locator('.workspace-entry').first();
  await firstWorkspaceEntry.locator('.workspace-copy').click();
  await firstWorkspaceEntry.hover();
  await firstWorkspaceEntry.getByRole('button', { name: '编辑工作区', exact: true }).click();
  const editWorkspaceDialog = page.getByRole('dialog', { name: '编辑工作区' });
  await editWorkspaceDialog.waitFor();
  await assertWithinViewport(editWorkspaceDialog, 'edit workspace dialog');
  const themeBefore = await page.evaluate(() => {
    const root = document.querySelector('app-root');
    const panelHost = document.querySelector('app-terminal-panel');
    const terminal = panelHost && globalThis.ng?.getComponent(panelHost)?.terminal;
    const style = root ? getComputedStyle(root) : null;
    return {
      accent: style?.getPropertyValue('--color-primary').trim(),
      surface: style?.getPropertyValue('--surface-0').trim(),
      terminalBackground: terminal?.options.theme?.background,
    };
  });
  await editWorkspaceDialog.getByRole('button', { name: '紫罗兰', exact: true }).click();
  await editWorkspaceDialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await editWorkspaceDialog.waitFor({ state: 'detached' });
  await page.waitForTimeout(120);
  const themeAfter = await page.evaluate(() => {
    const root = document.querySelector('app-root');
    const panelHost = document.querySelector('app-terminal-panel');
    const terminal = panelHost && globalThis.ng?.getComponent(panelHost)?.terminal;
    const style = root ? getComputedStyle(root) : null;
    return {
      accent: style?.getPropertyValue('--color-primary').trim(),
      surface: style?.getPropertyValue('--surface-0').trim(),
      terminalCursor: terminal?.options.theme?.cursor,
      terminalBackground: terminal?.options.theme?.background,
    };
  });
  if (
    themeAfter.accent !== '#a78bfa' ||
    themeAfter.terminalCursor !== '#a78bfa' ||
    themeAfter.surface === themeBefore.surface ||
    themeAfter.terminalBackground === themeBefore.terminalBackground
  ) {
    throw new Error(
      `workspace theme did not update the app and CLI terminal: ${JSON.stringify({
        themeBefore,
        themeAfter,
      })}`,
    );
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

  const fontSizeOutput = page.locator('.font-size-controls output');
  const initialFontSize = Number(await fontSizeOutput.textContent());
  await page.getByRole('button', { name: '增大终端字体' }).click();
  await fontSizeOutput.filter({ hasText: String(initialFontSize + 1) }).waitFor();
  const storedFontSize = await page.evaluate(() =>
    localStorage.getItem('termexo.terminalFontSize'),
  );
  if (storedFontSize !== String(initialFontSize + 1)) {
    throw new Error('terminal font size was not persisted');
  }
  await page.getByRole('button', { name: '减小终端字体' }).click();

  const terminalTabLabels = page.locator('.tab-strip button[role="tab"] > span');
  const tabOrderBefore = await terminalTabLabels.allTextContents();
  const activeTabName = (
    await page.locator('.tab-strip button.active > span').textContent()
  )?.trim();
  const activeTabIndexBefore = tabOrderBefore.findIndex((name) => name.trim() === activeTabName);
  await page.getByRole('button', { name: '将当前终端向左移动' }).click();
  await page.waitForTimeout(120);
  const tabOrderAfter = await terminalTabLabels.allTextContents();
  const activeTabIndexAfter = tabOrderAfter.findIndex((name) => name.trim() === activeTabName);
  if (activeTabIndexBefore < 1 || activeTabIndexAfter !== activeTabIndexBefore - 1) {
    throw new Error(
      `terminal tab did not move left: ${JSON.stringify({
        activeTabName,
        tabOrderBefore,
        tabOrderAfter,
      })}`,
    );
  }

  const activeTerminalPanel = page.locator('.terminal-panel.active');
  const seededScrollback = await activeTerminalPanel.evaluate((panel) => {
    const host = panel.closest('app-terminal-panel');
    const component = host && globalThis.ng?.getComponent(host);
    const terminal = component?.terminal;
    if (!terminal) {
      return false;
    }
    for (let index = 0; index < 90; index += 1) {
      terminal.writeln(`scrollback test line ${index + 1}`);
    }
    return true;
  });
  if (!seededScrollback) {
    throw new Error('terminal component was unavailable for scrollback smoke setup');
  }
  await page.waitForTimeout(180);
  const bufferBeforeScroll = await activeTerminalPanel.evaluate((panel) => {
    const host = panel.closest('app-terminal-panel');
    const terminal = host && globalThis.ng?.getComponent(host)?.terminal;
    const buffer = terminal?.buffer.active;
    return buffer ? { baseY: buffer.baseY, viewportY: buffer.viewportY, type: buffer.type } : null;
  });
  if (!bufferBeforeScroll || bufferBeforeScroll.baseY <= 0) {
    throw new Error(
      `terminal did not retain enough scrollback content: ${JSON.stringify(bufferBeforeScroll)}`,
    );
  }
  await activeTerminalPanel.locator('.xterm-scrollable-element').hover();
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(120);
  const viewportYAfterScroll = await activeTerminalPanel.evaluate((panel) => {
    const host = panel.closest('app-terminal-panel');
    return host && globalThis.ng?.getComponent(host)?.terminal?.buffer.active.viewportY;
  });
  if (
    typeof viewportYAfterScroll !== 'number' ||
    viewportYAfterScroll >= bufferBeforeScroll.viewportY
  ) {
    throw new Error('terminal viewport did not scroll upward');
  }

  const workspaceItemsForSwitch = page.locator('.workspace-item');
  if ((await workspaceItemsForSwitch.count()) > 1) {
    const preservedPanel = page.locator('.terminal-panel').first();
    const preservedTerminalStored = await preservedPanel.evaluate((panel) => {
      const host = panel.closest('app-terminal-panel');
      const terminal = host && globalThis.ng?.getComponent(host)?.terminal;
      globalThis.__termexoSmokePreservedTerminal = terminal;
      return Boolean(terminal);
    });
    if (!preservedTerminalStored) {
      throw new Error('terminal instance was unavailable before switching workspaces');
    }
    await workspaceItemsForSwitch.nth(1).click({ position: { x: 12, y: 12 } });
    await page.locator('app-terminal-workbench:not(.workspace-hidden) .empty-state').waitFor();
    await workspaceItemsForSwitch.first().click({ position: { x: 12, y: 12 } });
    const restoredActivePanel = page.locator('.terminal-panel.active');
    await restoredActivePanel.waitFor();
    await page.waitForTimeout(220);
    const activeTerminalFocused = await restoredActivePanel.evaluate((panel) =>
      panel.contains(document.activeElement),
    );
    if (!activeTerminalFocused) {
      throw new Error('active terminal was not focused after switching workspaces');
    }
    const terminalInstancePreserved = await page
      .locator('.terminal-panel')
      .first()
      .evaluate((panel) => {
        const host = panel.closest('app-terminal-panel');
        const terminal = host && globalThis.ng?.getComponent(host)?.terminal;
        return terminal === globalThis.__termexoSmokePreservedTerminal;
      });
    if (!terminalInstancePreserved) {
      throw new Error('terminal instance was recreated while switching workspaces');
    }

    const restoredPanels = page.locator('.terminal-panel');
    const lowerPanel = restoredPanels.nth(Math.min(1, (await restoredPanels.count()) - 1));
    const lowerPanelBuffer = await lowerPanel.evaluate((panel) => {
      const host = panel.closest('app-terminal-panel');
      const terminal = host && globalThis.ng?.getComponent(host)?.terminal;
      if (!terminal) {
        return null;
      }
      for (let index = 0; index < 90; index += 1) {
        terminal.writeln(`workspace switch scrollback line ${index + 1}`);
      }
      terminal.scrollToBottom();
      return true;
    });
    if (!lowerPanelBuffer) {
      throw new Error('lower terminal was unavailable after switching workspaces');
    }
    await page.waitForTimeout(180);
    const lowerViewportBeforeScroll = await lowerPanel.evaluate((panel) => {
      const host = panel.closest('app-terminal-panel');
      return host && globalThis.ng?.getComponent(host)?.terminal?.buffer.active.viewportY;
    });
    await lowerPanel.locator('.xterm-scrollable-element').hover();
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(120);
    const lowerPanelState = await lowerPanel.evaluate((panel) => {
      const host = panel.closest('app-terminal-panel');
      const terminal = host && globalThis.ng?.getComponent(host)?.terminal;
      return {
        active: panel.classList.contains('active'),
        focused: panel.contains(document.activeElement),
        viewportY: terminal?.buffer.active.viewportY,
      };
    });
    if (
      !lowerPanelState.active ||
      !lowerPanelState.focused ||
      typeof lowerPanelState.viewportY !== 'number' ||
      typeof lowerViewportBeforeScroll !== 'number' ||
      lowerPanelState.viewportY >= lowerViewportBeforeScroll
    ) {
      throw new Error(
        `lower terminal did not activate and scroll after workspace switch: ${JSON.stringify({
          lowerViewportBeforeScroll,
          lowerPanelState,
        })}`,
      );
    }
  }

  const seededAgentEvents = await page.evaluate(() => {
    const root = document.querySelector('app-root');
    const app = root && globalThis.ng?.getComponent(root);
    const terminal = app?.state?.activeTerminal();
    if (!terminal || !app?.agents?.eventItems?.set) {
      return false;
    }
    app.agents.eventItems.set(
      Array.from({ length: 12 }, (_, index) => ({
        eventKey: `smoke-event-${index}`,
        agentType: 'claude',
        nativeSessionId: 'smoke-session',
        terminalId: terminal.id,
        eventType: 'tool.completed',
        detail: { tool_name: `Smoke tool ${index + 1}` },
        createdAt: Date.now() - index * 1_000,
      })),
    );
    return true;
  });
  if (!seededAgentEvents) {
    throw new Error('Agent event state was unavailable for activity smoke setup');
  }
  await page.locator('.activity .event-row').nth(11).waitFor();
  if ((await page.locator('.activity .event-row').count()) !== 12) {
    throw new Error('recent activity did not render the expanded event history');
  }

  const globalNoticeSeed = await page.evaluate(() => {
    const root = document.querySelector('app-root');
    const app = root && globalThis.ng?.getComponent(root);
    const terminal = app?.state?.activeTerminal();
    const sourceWorkspace = app?.state?.activeWorkspace();
    const backgroundWorkspace = app?.state
      ?.workspaces()
      .find((workspace) => workspace.id !== sourceWorkspace?.id);
    if (!terminal || !sourceWorkspace || !backgroundWorkspace) {
      return null;
    }
    app.state.updateTerminalStatus(terminal.id, 'WAITING_INPUT');
    app.state.selectWorkspace(backgroundWorkspace.id);
    return {
      workspaceName: sourceWorkspace.name,
      terminalName: terminal.name,
    };
  });
  if (!globalNoticeSeed) {
    throw new Error('cross-workspace notice smoke setup failed');
  }

  const globalNoticeTrigger = page.getByRole('button', {
    name: '全局 Agent 提示',
    exact: true,
  });
  await globalNoticeTrigger.waitFor();
  await globalNoticeTrigger.click();
  const globalNoticePanel = page.getByRole('dialog', { name: '全局 Agent 提示' });
  await globalNoticePanel.waitFor();
  await assertWithinViewport(globalNoticePanel, 'global Agent notice panel');
  const globalNoticeItem = globalNoticePanel
    .locator('.global-notice-item[data-status="WAITING_INPUT"]')
    .filter({ hasText: globalNoticeSeed.workspaceName })
    .filter({ hasText: globalNoticeSeed.terminalName });
  await globalNoticeItem.waitFor();
  await globalNoticeItem.click();

  const waitingPanel = page.locator('.terminal-panel[data-status="WAITING_INPUT"]');
  await waitingPanel.waitFor();
  const waitingVisual = await waitingPanel.evaluate((panel) => {
    const panelStyle = getComputedStyle(panel);
    const lightStyle = getComputedStyle(panel.querySelector('.status-light'));
    const labelStyle = getComputedStyle(panel.querySelector('.status-label'));
    return {
      boxShadow: panelStyle.boxShadow,
      lightBackground: lightStyle.backgroundColor,
      labelColor: labelStyle.color,
    };
  });
  if (
    waitingVisual.boxShadow === 'none' ||
    waitingVisual.lightBackground === 'transparent' ||
    waitingVisual.lightBackground === 'rgba(0, 0, 0, 0)' ||
    waitingVisual.labelColor === 'transparent'
  ) {
    throw new Error('waiting-for-input status is not visually prominent');
  }

  await page.evaluate(() => {
    const root = document.querySelector('app-root');
    const app = root && globalThis.ng?.getComponent(root);
    const terminal = app?.state?.activeTerminal();
    if (terminal) {
      app.state.updateTerminalStatus(terminal.id, 'COMPLETED');
    }
  });
  await page.locator('.terminal-panel[data-status="COMPLETED"]').waitFor();

  const workspaceEntries = page.locator('.workspace-entry');
  if ((await workspaceEntries.count()) === 0) {
    throw new Error('workspace menu did not render any entries');
  }
  const firstWorkspaceMenuEntry = workspaceEntries.first();
  if ((await firstWorkspaceMenuEntry.locator('button button').count()) !== 0) {
    throw new Error('workspace menu contains nested interactive buttons');
  }
  await firstWorkspaceMenuEntry.hover();
  await page.waitForTimeout(180);
  const workspaceActions = firstWorkspaceMenuEntry.locator('.workspace-actions');
  const [workspaceEntryBox, workspaceActionsBox, workspaceActionsOpacity] = await Promise.all([
    firstWorkspaceMenuEntry.boundingBox(),
    workspaceActions.boundingBox(),
    workspaceActions.evaluate((element) => getComputedStyle(element).opacity),
  ]);
  if (
    !workspaceEntryBox ||
    !workspaceActionsBox ||
    Number(workspaceActionsOpacity) < 0.99 ||
    workspaceActionsBox.x + workspaceActionsBox.width >
      workspaceEntryBox.x + workspaceEntryBox.width + 1
  ) {
    throw new Error(
      `workspace menu actions are hidden or overflow their entry: ${JSON.stringify({
        workspaceEntryBox,
        workspaceActionsBox,
        workspaceActionsOpacity,
      })}`,
    );
  }

  const toast = page.locator('.app-toast-region > .app-toast.alert');
  await toast.waitFor();
  const toastBox = await toast.boundingBox();
  if (
    !toastBox ||
    toastBox.width > 430 ||
    toastBox.height < 40 ||
    toastBox.x < 0 ||
    toastBox.y < 0 ||
    toastBox.x + toastBox.width > 1440 ||
    toastBox.y + toastBox.height > 900
  ) {
    throw new Error('application toast is incorrectly sized or outside the viewport');
  }
  await page.screenshot({
    path: join(tmpdir(), 'termexo-workspace-menu.png'),
    fullPage: true,
  });

  const workspaceSidebar = page.locator('app-workspace-sidebar');
  const workspaceResizeHandle = page.getByRole('separator', {
    name: '调整工作区侧栏宽度',
  });
  const initialWorkspaceSidebarBox = await workspaceSidebar.boundingBox();
  const workspaceResizeBox = await workspaceResizeHandle.boundingBox();
  if (!initialWorkspaceSidebarBox || !workspaceResizeBox) {
    throw new Error('workspace sidebar resize handle did not render');
  }
  await page.mouse.move(
    workspaceResizeBox.x + workspaceResizeBox.width / 2,
    workspaceResizeBox.y + 120,
  );
  await page.mouse.down();
  await page.mouse.move(workspaceResizeBox.x + 44, workspaceResizeBox.y + 120);
  await page.mouse.up();
  const resizedWorkspaceSidebarBox = await workspaceSidebar.boundingBox();
  if (
    !resizedWorkspaceSidebarBox ||
    resizedWorkspaceSidebarBox.width < initialWorkspaceSidebarBox.width + 30
  ) {
    throw new Error('workspace sidebar width did not respond to dragging');
  }
  await page.getByRole('button', { name: '折叠工作区侧栏' }).click();
  await workspaceSidebar.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '展开工作区侧栏' }).click();
  await workspaceSidebar.waitFor();

  const inspectorPanel = page.locator('app-inspector-panel');
  await page.getByRole('button', { name: '折叠 Agent 侧栏' }).click();
  await inspectorPanel.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '展开 Agent 侧栏' }).click();
  await inspectorPanel.waitFor();

  await toolbar.getByRole('button', { name: 'Agent', exact: true }).click();
  const agentMenu = page.locator('.agent-menu');
  await agentMenu.waitFor();
  await assertWithinViewport(agentMenu, 'Agent menu');
  if ((await agentMenu.getByText(/Gemini|Google CLI/i).count()) !== 0) {
    throw new Error('removed Google CLI feature is still visible');
  }
  page.once('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
  await page.getByRole('button', { name: /Claude Code/ }).click();
  const launchDialog = page.getByRole('dialog', { name: '新建 Claude 会话' });
  await launchDialog.waitFor();
  if (await launchDialog.getByRole('button', { name: '启动会话' }).isEnabled()) {
    throw new Error('Claude launch must be disabled in browser preview mode');
  }
  await launchDialog.getByRole('button', { name: '关闭' }).click();

  await toolbar.getByRole('button', { name: 'Agent', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept(dialog.defaultValue()));
  await page.getByRole('button', { name: /Codex CLI/ }).click();
  const codexLaunchDialog = page.getByRole('dialog', { name: '新建 Codex 会话' });
  await codexLaunchDialog.waitFor();
  await codexLaunchDialog.getByLabel('Codex 模型').fill('gpt-5.6-sol');
  await codexLaunchDialog.getByRole('button', { name: '关闭' }).click();

  await toolbar.getByRole('button', { name: 'Claude 模型', exact: true }).click();
  const modelSwitchDialog = page.getByRole('dialog', {
    name: '切换 Claude Code 后端模型',
  });
  await modelSwitchDialog.waitFor();
  await assertWithinViewport(modelSwitchDialog, 'model switch dialog');
  await modelSwitchDialog.getByRole('button', { name: '关闭', exact: true }).click();

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

  await page.waitForTimeout(220);
  await page.screenshot({
    path: join(tmpdir(), 'termexo-desktop.png'),
    fullPage: true,
  });

  await sessionDialog.locator('.session-footer').getByRole('button', { name: '关闭' }).click();
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Agent 与开发环境设置' });
  await settingsDialog.waitFor();
  await settingsDialog.getByRole('button', { name: '登录账号', exact: true }).click();
  await settingsDialog.getByRole('button', { name: '添加隔离账号', exact: true }).click();
  await settingsDialog.getByLabel('账号名称', { exact: true }).fill('Smoke ChatGPT');
  await settingsDialog.locator('.account-editor select').selectOption('codex');
  await settingsDialog.getByLabel('设为此 CLI 的默认登录账号', { exact: true }).check();
  const saveAccountButton = settingsDialog.getByRole('button', {
    name: '保存账号',
    exact: true,
  });
  await saveAccountButton.click();
  await settingsDialog
    .locator('.profile-nav button')
    .filter({ hasText: 'Smoke ChatGPT' })
    .waitFor();
  await saveAccountButton.click();
  const smokeAccountCount = await settingsDialog
    .locator('.profile-nav button')
    .filter({ hasText: 'Smoke ChatGPT' })
    .count();
  if (smokeAccountCount !== 1) {
    throw new Error('saving a new account twice created duplicate profiles');
  }

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

  await settingsDialog.getByRole('button', { name: '网络与 npm', exact: true }).click();
  await settingsDialog.getByRole('button', { name: '新建代理 Profile', exact: true }).click();
  await settingsDialog.getByLabel('名称', { exact: true }).fill('Smoke Network');
  await settingsDialog
    .getByLabel('HTTPS_PROXY', { exact: true })
    .fill('http://proxy.internal:8080');
  await settingsDialog
    .getByLabel('registry', { exact: true })
    .fill('https://registry.internal.example/');
  await settingsDialog.getByRole('button', { name: '保存代理 Profile', exact: true }).click();
  await settingsDialog
    .locator('.profile-nav button')
    .filter({ hasText: 'Smoke Network' })
    .waitFor();
  await settingsDialog.getByRole('button', { name: '测试连接', exact: true }).click();
  await settingsDialog
    .getByText('浏览器预览已验证 Profile 交互；桌面端会执行真实 TCP 连通性测试。', {
      exact: true,
    })
    .waitFor();

  await settingsDialog.getByRole('button', { name: 'CLI 安装与升级', exact: true }).click();
  await settingsDialog.getByLabel('CLI 目标版本', { exact: true }).fill('latest');
  await settingsDialog.getByRole('button', { name: '生成安装计划', exact: true }).click();
  await settingsDialog.getByText('@anthropic-ai/claude-code@latest', { exact: true }).waitFor();
  const executeCliButton = settingsDialog.getByRole('button', { name: '确认并安装', exact: true });
  if (!(await executeCliButton.isDisabled())) {
    throw new Error('CLI mutation became available before explicit confirmation');
  }
  await settingsDialog.locator('.cli-confirmation input').check();
  await executeCliButton.click({ trial: true });

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

  await page.waitForTimeout(220);
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
      screenshots: [
        join(tmpdir(), 'termexo-workspace-menu.png'),
        join(tmpdir(), 'termexo-desktop.png'),
        join(tmpdir(), 'termexo-compact.png'),
      ],
    }),
  );
} finally {
  await browser.close();
}
