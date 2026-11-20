import { chromium } from 'playwright-core';
import { resolveBrowserExecutable } from './lib/browser-executable.mjs';

const APP_URL = process.env.TERMEXO_URL ?? 'http://127.0.0.1:4200';
const BROWSER_PATH = resolveBrowserExecutable();

const browser = await chromium.launch({
  executablePath: BROWSER_PATH,
  headless: true,
});

try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.locator('.terminal-panel').first().waitFor();

  const setLayout = async (layout) => {
    const updated = await page.evaluate((nextLayout) => {
      const root = document.querySelector('app-root');
      const app = root && globalThis.ng?.getComponent(root);
      if (!app?.state?.setLayout) {
        return false;
      }
      app.state.setLayout(nextLayout);
      return true;
    }, layout);
    if (!updated) {
      throw new Error(`could not set terminal layout to ${layout}`);
    }
    await page.waitForTimeout(180);
  };

  const inspectViewport = async ({ label, width, height, expected }) => {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(260);

    const snapshot = await page.evaluate(() => {
      const toRect = (element) => {
        if (!element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        };
      };
      const trackCount = (value) =>
        value.trim() ? value.trim().split(/\s+/).filter(Boolean).length : 0;
      const shell = document.querySelector('.app-shell');
      const workbench = document.querySelector('app-terminal-workbench:not(.workspace-hidden)');
      const grid = workbench?.querySelector('.terminal-grid');
      const workspaceSidebar = document.querySelector('app-workspace-sidebar');
      const inspector = document.querySelector('app-inspector-panel');
      const panels = [
        ...(grid?.querySelectorAll('app-terminal-panel:not(.workbench-hidden) .terminal-panel') ??
          []),
      ];
      const screens = panels.map((panel) => panel.querySelector('.xterm-screen')).filter(Boolean);
      const gridStyle = grid ? getComputedStyle(grid) : null;
      const tabHeader = document.querySelector('.app-shell > .terminal-tabs');
      const toolbar = tabHeader && getComputedStyle(tabHeader).display !== 'none' ? tabHeader : null;
      const tabStrip = toolbar?.querySelector('.tab-strip');

      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: {
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
        },
        shell: toRect(shell),
        tabRow: toRect(toolbar),
        workbench: toRect(workbench),
        grid: toRect(grid),
        workspaceSidebar: toRect(workspaceSidebar),
        workspaceSidebarVisible:
          Boolean(workspaceSidebar) && getComputedStyle(workspaceSidebar).display !== 'none',
        brandCount: [...document.querySelectorAll('.app-brand')].filter((brand) => brand.getClientRects().length).length,
        sidebarBrand: Boolean(workspaceSidebar?.querySelector('.sidebar-heading .app-brand')?.getClientRects().length),
        inspector: toRect(inspector),
        inspectorVisible: Boolean(inspector) && getComputedStyle(inspector).display !== 'none',
        statusDisplay: getComputedStyle(document.querySelector('.statusbar')).display,
        layout: grid?.getAttribute('data-layout'),
        visibleCount: Number(grid?.getAttribute('data-visible-count') ?? 0),
        columnTracks: trackCount(gridStyle?.gridTemplateColumns ?? ''),
        rowTracks: trackCount(gridStyle?.gridTemplateRows ?? ''),
        overflowX: gridStyle?.overflowX,
        overflowY: gridStyle?.overflowY,
        panels: panels.map(toRect),
        screens: screens.map(toRect),
        footers: panels.map((panel) => getComputedStyle(panel.querySelector('footer')).display),
        headerControls: panels
          .flatMap((panel) => [...panel.querySelectorAll('header button')])
          .map(toRect),
        toolbarClipped: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : 0,
        hasTabScrollbar: tabStrip ? /auto|scroll/.test(getComputedStyle(tabStrip).overflowX) : false,
        hiddenTabs: tabStrip?.querySelectorAll('.tab-slot[hidden]').length ?? 0,
        overflowTrigger: Boolean(toolbar?.querySelector('[data-testid="tab-overflow-toggle"]')),
        activeTabInRow: Boolean(tabStrip?.querySelector('.tab-slot:not([hidden]) .tab.active')),
      };
    });

    const viewport = snapshot.viewport;
    if (
      snapshot.document.scrollWidth > snapshot.document.clientWidth ||
      snapshot.document.scrollHeight > snapshot.document.clientHeight
    ) {
      throw new Error(`${label}: document overflowed: ${JSON.stringify(snapshot.document)}`);
    }
    if (
      !snapshot.shell ||
      snapshot.shell.x < -1 ||
      snapshot.shell.y < -1 ||
      snapshot.shell.right > viewport.width + 1 ||
      snapshot.shell.bottom > viewport.height + 1
    ) {
      throw new Error(`${label}: app shell is outside the viewport`);
    }
    if (
      !snapshot.workbench ||
      !snapshot.grid ||
      snapshot.visibleCount !== (expected.visibleCount ?? 2)
    ) {
      throw new Error(`${label}: terminal workbench rendered the wrong terminal count`);
    }
    if (
      snapshot.workspaceSidebarVisible !== expected.workspaceSidebar ||
      snapshot.inspectorVisible !== expected.inspector
    ) {
      throw new Error(`${label}: sidebar state is incorrect: ${JSON.stringify(snapshot)}`);
    }
    if (snapshot.workspaceSidebarVisible && Math.abs(snapshot.workspaceSidebar.y - snapshot.shell.y) > 1) {
      throw new Error(`${label}: workspace sidebar does not start at the top of the window`);
    }
    if (snapshot.inspectorVisible && Math.abs(snapshot.inspector.y - snapshot.shell.y) > 1) {
      throw new Error(`${label}: the Work status panel does not start at the top of the window`);
    }
    if (expected.focusMode) {
      if (snapshot.tabRow || snapshot.brandCount !== 0 || Math.abs(snapshot.workbench.y - snapshot.shell.y) > 1) {
        throw new Error(`${label}: the terminal does not fill the window with its tabs hidden`);
      }
    } else {
      if (!snapshot.tabRow || Math.abs(snapshot.tabRow.y - snapshot.shell.y) > 1) {
        throw new Error(`${label}: the terminal tabs are not at the window edge`);
      }
      if (snapshot.brandCount !== 1 || snapshot.sidebarBrand !== snapshot.workspaceSidebarVisible) {
        throw new Error(`${label}: brand is not in the leftmost header`);
      }
    }
    if (
      snapshot.columnTracks !== expected.columnTracks ||
      snapshot.rowTracks !== expected.rowTracks
    ) {
      throw new Error(`${label}: terminal tracks did not adapt: ${JSON.stringify(snapshot)}`);
    }
    if (snapshot.statusDisplay !== expected.statusDisplay) {
      throw new Error(`${label}: status bar visibility is incorrect`);
    }
    // Closing and maximizing a terminal live here; a header wider than the panel used to push
    // them past the right edge with no way to scroll to them.
    if (snapshot.headerControls.some((rect) => !rect || rect.right > viewport.width + 1)) {
      throw new Error(
        `${label}: terminal header controls are off screen: ${JSON.stringify(snapshot.headerControls)}`,
      );
    }
    if (snapshot.hasTabScrollbar || snapshot.overflowTrigger !== (snapshot.hiddenTabs > 0)) {
      throw new Error(label + ': overflowing tabs should be in a menu');
    }
    if (!expected.focusMode && !snapshot.activeTabInRow) {
      throw new Error(label + ': the active terminal tab was pushed into the menu');
    }
    // Leave room for the New button and terminal controls.
    if (snapshot.toolbarClipped > 1) {
      throw new Error(
        `${label}: ${snapshot.toolbarClipped}px of the terminal toolbar is hidden behind a scroll`,
      );
    }
    if (
      snapshot.screens.length !== snapshot.visibleCount ||
      snapshot.screens.some((screen) => !screen || screen.width < 80 || screen.height < 36)
    ) {
      throw new Error(
        `${label}: xterm did not refit to a usable size: ${JSON.stringify(snapshot)}`,
      );
    }

    return {
      label,
      viewport: snapshot.viewport,
      workbench: snapshot.workbench,
      layout: snapshot.layout,
      tracks: `${snapshot.columnTracks}x${snapshot.rowTracks}`,
      sidebars: {
        workspace: snapshot.workspaceSidebarVisible,
        inspector: snapshot.inspectorVisible,
      },
      statusDisplay: snapshot.statusDisplay,
      footers: snapshot.footers,
    };
  };

  await setLayout('grid');
  const results = [];
  results.push(
    await inspectViewport({
      label: 'desktop',
      width: 1440,
      height: 900,
      expected: {
        workspaceSidebar: true,
        inspector: true,
        columnTracks: 2,
        rowTracks: 1,
        statusDisplay: 'flex',
      },
    }),
  );
  const activeTerminal = page.locator('app-terminal-workbench:not(.workspace-hidden) .terminal-panel.active');
  const terminalFocusToggle = activeTerminal.getByTestId('terminal-focus-toggle');
  const layoutFillToggle = activeTerminal.getByTestId('terminal-layout-fill-toggle');
  const enterTerminalFocus = async () => {
    await terminalFocusToggle.click();
    await page.locator('.app-shell.terminal-focus-mode').waitFor();
  };
  const waitForRestoredLayout = () => page.locator('.app-shell:not(.terminal-focus-mode)').waitFor();
  await enterTerminalFocus();
  results.push(
    await inspectViewport({
      label: 'terminal-focus-desktop',
      width: 1440,
      height: 900,
      expected: {
        focusMode: true,
        workspaceSidebar: false,
        inspector: false,
        visibleCount: 1,
        columnTracks: 1,
        rowTracks: 1,
        statusDisplay: 'none',
      },
    }),
  );
  await terminalFocusToggle.click();
  await waitForRestoredLayout();
  await layoutFillToggle.click();
  results.push(
    await inspectViewport({
      label: 'terminal-maximized',
      width: 1440,
      height: 900,
      expected: {
        workspaceSidebar: true,
        inspector: true,
        visibleCount: 1,
        columnTracks: 1,
        rowTracks: 1,
        statusDisplay: 'flex',
      },
    }),
  );
  await layoutFillToggle.click();
  results.push(
    await inspectViewport({
      label: 'compact-workspace',
      width: 900,
      height: 600,
      expected: {
        workspaceSidebar: true,
        inspector: true,
        columnTracks: 1,
        rowTracks: 2,
        statusDisplay: 'flex',
      },
    }),
  );
  results.push(
    await inspectViewport({
      label: 'minimum-window',
      width: 720,
      height: 480,
      expected: {
        workspaceSidebar: false,
        inspector: false,
        columnTracks: 1,
        rowTracks: 2,
        statusDisplay: 'none',
      },
    }),
  );
  await enterTerminalFocus();
  results.push(
    await inspectViewport({
      label: 'terminal-focus-minimum-window',
      width: 720,
      height: 480,
      expected: {
        focusMode: true,
        workspaceSidebar: false,
        inspector: false,
        visibleCount: 1,
        columnTracks: 1,
        rowTracks: 1,
        statusDisplay: 'none',
      },
    }),
  );
  await page.locator('app-terminal-panel:not(.workbench-hidden) .xterm-helper-textarea').focus();
  await page.keyboard.press('Shift+Escape');
  await waitForRestoredLayout();

  // A phone reached through remote access. The workspace still stores the grid layout; drawing
  // falls back to a single terminal, and both side panels float instead of taking a column.
  results.push(
    await inspectViewport({
      label: 'phone',
      width: 390,
      height: 844,
      expected: {
        workspaceSidebar: false,
        inspector: false,
        visibleCount: 1,
        columnTracks: 1,
        rowTracks: 1,
        statusDisplay: 'flex',
      },
    }),
  );

  // Notifications share the narrow tab row with the active tab and terminal controls.
  await page.setViewportSize({ width: 320, height: 512 });
  const noticeFixture = await page.evaluate(() => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    const { id, status } = app.state.activeTerminal();
    app.state.updateTerminalStatus(id, 'WAITING_INPUT');
    return { id, status };
  });
  const noticeTrigger = page.locator('.global-notice-trigger');
  const noticePanel = page.locator('.global-notice-panel');
  const waitForVisibleActiveTab = () => page.waitForFunction(() => {
    const caption = document.querySelector('.tab.active .tab-caption');
    const toolbar = document.querySelector('.terminal-tabs');
    return caption?.getBoundingClientRect().width >= 12 && toolbar.scrollWidth <= toolbar.clientWidth;
  });

  await waitForVisibleActiveTab();
  await noticeTrigger.click();
  await noticePanel.waitFor();
  const panelBounds = await noticePanel.boundingBox();
  const triggerBounds = await noticeTrigger.boundingBox();
  if (
    !panelBounds ||
    !triggerBounds ||
    panelBounds.x < 7 ||
    panelBounds.x + panelBounds.width > 313 ||
    panelBounds.y < triggerBounds.y + triggerBounds.height ||
    panelBounds.y + panelBounds.height > 505
  ) {
    throw new Error('notice panel is outside the narrow viewport or overlapping its trigger');
  }
  await page.keyboard.press('Escape');
  await noticePanel.waitFor({ state: 'hidden' });
  if (!(await noticeTrigger.evaluate((button) => button === document.activeElement))) {
    throw new Error('Escape should restore focus to the notices button');
  }

  await noticeTrigger.click();
  await noticePanel.waitFor();
  await page.mouse.click(20, 490);
  await noticePanel.waitFor({ state: 'hidden' });

  // Render the remote indicators in the local preview to measure the space they take.
  await page.evaluate((id) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    app.remoteMode = true;
    app.state.updateTerminalStatus(id, 'FAILED');
  }, noticeFixture.id);
  await page.locator('app-remote-connection-badge .remote-badge').waitFor();
  await waitForVisibleActiveTab();
  await page.setViewportSize({ width: 390, height: 512 });
  await waitForVisibleActiveTab();
  await page.evaluate(({ id, status }) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    app.state.updateTerminalStatus(id, status);
  }, noticeFixture);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.terminal-panel').first().waitFor();

  // Keep the workbench itself above 720px after both sidebars take their columns.
  await page.setViewportSize({ width: 1440, height: 480 });
  const sidebarsReopened = await page.evaluate(() => {
    const root = document.querySelector('app-root');
    const app = root && globalThis.ng?.getComponent(root);
    if (!app?.workspaceSidebarOpen?.set || !app?.inspectorOpen?.set) {
      return false;
    }
    app.workspaceSidebarOpen.set(true);
    app.inspectorOpen.set(true);
    return true;
  });
  if (!sidebarsReopened) {
    throw new Error('could not reopen sidebars for short-window verification');
  }
  await setLayout('rows');
  results.push(
    await inspectViewport({
      label: 'short-window',
      width: 1440,
      height: 480,
      expected: {
        workspaceSidebar: true,
        inspector: true,
        columnTracks: 2,
        rowTracks: 1,
        statusDisplay: 'none',
      },
    }),
  );

  if (errors.length > 0) {
    throw new Error(`browser errors:\n${errors.join('\n')}`);
  }

  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
