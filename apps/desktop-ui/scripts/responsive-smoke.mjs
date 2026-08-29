import { chromium } from 'playwright-core';

const APP_URL = process.env.TERMEXO_URL ?? 'http://127.0.0.1:4200';
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

      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: {
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
        },
        shell: toRect(shell),
        workbench: toRect(workbench),
        grid: toRect(grid),
        workspaceSidebar: toRect(workspaceSidebar),
        workspaceSidebarVisible:
          Boolean(workspaceSidebar) && getComputedStyle(workspaceSidebar).display !== 'none',
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
    if (
      snapshot.columnTracks !== expected.columnTracks ||
      snapshot.rowTracks !== expected.rowTracks
    ) {
      throw new Error(`${label}: terminal tracks did not adapt: ${JSON.stringify(snapshot)}`);
    }
    if (snapshot.statusDisplay !== expected.statusDisplay) {
      throw new Error(`${label}: status bar visibility is incorrect`);
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
  const workspaceMaximizeButton = page.locator('[data-testid="workspace-maximize-toggle"]');
  await workspaceMaximizeButton.click();
  await page.locator('.app-shell.workspace-maximized').waitFor();
  results.push(
    await inspectViewport({
      label: 'workspace-maximized',
      width: 1440,
      height: 900,
      expected: {
        workspaceSidebar: false,
        inspector: false,
        columnTracks: 2,
        rowTracks: 1,
        statusDisplay: 'none',
      },
    }),
  );
  await workspaceMaximizeButton.click();
  await page.locator('.app-shell:not(.workspace-maximized)').waitFor();
  const terminalMaximizeButton = page
    .locator('.terminal-panel:not(.workbench-hidden) .terminal-meta button.btn')
    .first();
  await terminalMaximizeButton.click();
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
  await terminalMaximizeButton.click();
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
  await workspaceMaximizeButton.click();
  results.push(
    await inspectViewport({
      label: 'minimum-window-maximized',
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
  await workspaceMaximizeButton.click();

  await page.setViewportSize({ width: 1220, height: 480 });
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
      width: 1220,
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
