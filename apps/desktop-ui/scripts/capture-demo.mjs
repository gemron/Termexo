import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  collectPageErrors,
  resolveExecutablePath,
  startDesktopSession,
  stopDesktopSession,
} from './lib/desktop-session.mjs';
import { restorePendingStash, stashApplicationDatabase } from './lib/isolated-app-data.mjs';
import {
  discardFrames,
  renderAnimatedGif,
  renderVideo,
  startRecording,
} from './lib/screen-recorder.mjs';

/**
 * Records the V0.6 feature demos against the real desktop build.
 *
 * Everything runs against a stashed-aside database so the clips only ever show a purpose-built
 * demo workspace — never the operator's own projects, paths or tasks. Each scene produces an MP4
 * for the website and release notes plus a size-capped GIF for WeChat and the README.
 *
 * Usage:
 *   node scripts/capture-demo.mjs                 # every scene
 *   node scripts/capture-demo.mjs --scene=tasks   # a single scene
 *   node scripts/capture-demo.mjs --keep-frames   # leave the raw frames on disk
 */

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const mediaDirectory = resolve(repositoryRoot, 'docs/promotion/media');
const frameRootDirectory = resolve(repositoryRoot, '.tooling/demo-frames');
/** A throwaway WebView2 profile, so the demo starts with empty localStorage every time. */
const webviewProfileDirectory = resolve(repositoryRoot, '.tooling/demo-webview2');

/** A throwaway project so an Agent has somewhere harmless to work. */
const DEMO_PROJECT_DIRECTORY = process.env.TERMEXO_DEMO_PROJECT ?? 'D:\\devlop\\termexo-demo';
const DEMO_WORKSPACE_NAME = 'shop-api';
const DEMO_WORKSPACE_ID = 'demo-workspace-v06';
const DEMO_THEME_COLOR = '#10b981';

const SETTLE_MS = 900;
const READING_PAUSE_MS = 1800;
const TASK_STAGE_TIMEOUT_MS = 180_000;
const SESSION_SCAN_TIMEOUT_MS = 30_000;
const WORKBENCH_RESPONSE_WINDOW_MS = 14_000;
const TERMINAL_START_TIMEOUT_MS = 30_000;
const VIEW_SWITCH_TIMEOUT_MS = 10_000;
const ACCEPTANCE_TIMEOUT_MS = 15_000;
/** Roughly the middle of the session centre dialog at the 1440x900 window size. */
const SESSION_LIST_CENTRE = { x: 720, y: 480 };
const SESSION_LIST_SCROLL_PIXELS = 320;

/**
 * Order matters: the workbench scene runs a real Agent in the demo workspace, which is what
 * gives the session centre scene something of its own to list instead of falling back to the
 * operator's real projects.
 */
const scenes = [
  { key: 'workbench', title: '多终端网格与状态提醒', run: recordWorkbenchScene },
  { key: 'tasks', title: '任务看板跑成 Agent 终端', run: recordTaskBoardScene },
  { key: 'sessions', title: '会话中心恢复历史会话', run: recordSessionCenterScene },
  { key: 'models', title: '模型与供应商 Profile', run: recordModelProfileScene },
];

const requestedScene = readArgument('--scene');
const keepFrames = process.argv.includes('--keep-frames');
const selectedScenes = requestedScene
  ? scenes.filter((scene) => scene.key === requestedScene)
  : scenes;

if (selectedScenes.length === 0) {
  throw new Error(
    `Unknown scene "${requestedScene}". Available: ${scenes.map((scene) => scene.key).join(', ')}`,
  );
}

// Recovery entry point for a run that was interrupted before it could put the database back.
if (process.argv.includes('--restore')) {
  const restoredFiles = await restorePendingStash();
  console.log(
    restoredFiles.length > 0
      ? `restored:\n${restoredFiles.join('\n')}`
      : 'nothing to restore — no stash was left behind.',
  );
  process.exit(0);
}

// A closed stdout must not take the process down before the database is put back.
process.stdout.on('error', () => undefined);

await mkdir(mediaDirectory, { recursive: true });
// Start from an empty profile: a leftover one carries the previous run's task cards.
await rm(webviewProfileDirectory, { recursive: true, force: true });
await ensureDemoProject();

console.log(`executable: ${resolveExecutablePath(repositoryRoot)}`);
console.log('stashing the real database so the demo runs on a clean instance…');
const stash = await stashApplicationDatabase();

// The async restore in the finally block never runs when a signal kills the process, so the
// real database is also put back synchronously on the way out.
const restoreOnExit = () => {
  try {
    stash.restoreSync();
  } catch (error) {
    console.error(`could not restore the database automatically: ${error.message}`);
  }
};
process.on('exit', restoreOnExit);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    restoreOnExit();
    process.exit(1);
  });
}

const results = [];
const failedScenes = [];
let session;
try {
  session = await startDesktopSession({
    repositoryRoot,
    // The task board keeps its cards in localStorage, which lives in the WebView2 profile rather
    // than in the database — stashing the database alone leaves every previous run's tasks on the
    // board. A throwaway profile isolates it without touching the operator's own localStorage.
    environment: { WEBVIEW2_USER_DATA_FOLDER: webviewProfileDirectory },
  });
  const { page } = session;
  const errors = collectPageErrors(page);
  await page.waitForTimeout(SETTLE_MS * 3);
  await seedDemoWorkspace(page);

  for (const scene of selectedScenes) {
    console.log(`\n▶ ${scene.key} — ${scene.title}`);
    const outcome = await recordScene(page, scene);
    results.push(outcome);
    console.log(
      `  mp4 ${formatBytes(outcome.video.bytes)} · gif ${formatBytes(outcome.gif.bytes)}` +
        `${outcome.gif.exceedsSizeLimit ? ' (still above the size limit)' : ''}`,
    );
    if (outcome.failure) {
      failedScenes.push(`${outcome.scene}: ${outcome.failure}`);
    }
  }

  if (errors.length > 0) {
    console.warn(`\npage errors during capture:\n${errors.join('\n')}`);
  }
} finally {
  if (session) {
    await stopDesktopSession(session);
  }
  await stash.restore();
  console.log('\nrestored the real database.');
}

console.log(`\n${JSON.stringify({ media: results }, null, 2)}`);

if (failedScenes.length > 0) {
  console.error(`\nscenes that did not finish:\n${failedScenes.join('\n')}`);
  process.exitCode = 1;
}

/** Wraps a scene body in the recording lifecycle so every scene renders both outputs. */
async function recordScene(page, scene) {
  const frameDirectory = resolve(frameRootDirectory, scene.key);
  // Reset before the recorder starts so the tidying up never appears in the clip.
  await resetToTerminalView(page);
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  const recorder = await startRecording(page, {
    frameDirectory,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
  });

  // A scene that fails halfway is still rendered: the clip shows exactly where it broke, which
  // is far more useful than losing the frames along with the error.
  let sceneError;
  try {
    await scene.run(page, recorder);
  } catch (error) {
    sceneError = error;
    console.warn(`  scene failed, rendering what was captured: ${error.message}`);
  }

  const capture = await recorder.stop();
  const video = await renderVideo(capture, resolve(mediaDirectory, `termexo-${scene.key}.mp4`));
  const gif = await renderAnimatedGif(capture, resolve(mediaDirectory, `termexo-${scene.key}.gif`));

  if (!keepFrames) {
    await discardFrames(frameDirectory);
  }
  return {
    scene: scene.key,
    title: scene.title,
    frames: capture.frameCount,
    video,
    gif,
    failure: sceneError?.message,
  };
}

/**
 * Creates the demo workspace through the backend command.
 * The directory picker opens a native Windows dialog that Playwright cannot drive, so the
 * workspace is written directly and the page reloaded to pick it up.
 */
async function seedDemoWorkspace(page) {
  await page.evaluate(
    async ({ id, name, projectPath, themeColor }) => {
      await window.__TAURI_INTERNALS__.invoke('save_workspace', {
        workspace: {
          id,
          name,
          themeColor,
          sortOrder: 0,
          projectPath,
          projectType: 'node',
          activeBranch: 'main',
          favorite: false,
          lastOpenedAt: Date.now(),
          layout: 'single',
          gridColumns: 2,
          gridRows: 2,
          terminals: [],
        },
      });
    },
    {
      id: DEMO_WORKSPACE_ID,
      name: DEMO_WORKSPACE_NAME,
      projectPath: DEMO_PROJECT_DIRECTORY,
      themeColor: DEMO_THEME_COLOR,
    },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('toolbar', { name: '工作区工具' }).waitFor();
  await page.waitForTimeout(SETTLE_MS);

  // A fresh database ships with sample workspaces whose paths do not exist on disk. Selecting
  // the demo workspace is what gives the Agents a real directory to run in — without this the
  // terminal opens in a missing directory and never gets past the shell prompt.
  // Hovering the row floats .workspace-actions (move/edit/delete) over its middle, which
  // intercepts a normal click. This happens before recording starts, so dispatching the click
  // directly is fine and avoids depending on where the row's hit area happens to be free.
  await page
    .locator('button')
    .filter({ hasText: DEMO_WORKSPACE_NAME })
    .first()
    .evaluate((button) => button.click());
  await page.waitForTimeout(SETTLE_MS);

  // Confirm against the project path shown in the workspace header — matching on the name alone
  // also matches the application logo in the corner and silently passes.
  const activeDirectoryVisible = await page
    .getByText(DEMO_PROJECT_DIRECTORY, { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (!activeDirectoryVisible) {
    throw new Error(
      `${DEMO_WORKSPACE_NAME} (${DEMO_PROJECT_DIRECTORY}) did not become the active workspace; ` +
        `recording it would capture the wrong project.`,
    );
  }
}

/**
 * Returns the UI to the terminal view with no dialog open.
 * Scenes run back to back against one long-lived instance, so each one has to start from a
 * known state rather than from wherever the previous scene happened to stop.
 */
async function resetToTerminalView(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(SETTLE_MS / 3);
  await showTerminalView(page);
  await page.waitForTimeout(SETTLE_MS / 2);
}

/**
 * 终端 and 任务 are two separate view buttons, not one toggle: clicking 任务 while the board is
 * already open leaves it open. Switching views therefore has to name the view it wants.
 * The 终端 name is anchored so it does not also match 新建终端.
 */
async function showTerminalView(page) {
  const kanban = page.getByTestId('task-kanban');
  if (!(await kanban.isVisible().catch(() => false))) {
    return;
  }
  // The open board lays a .board-backdrop over the workbench, and that backdrop swallows the
  // click aimed at the 终端 tab. Dispatching the click on the element itself gets past it.
  await page
    .locator('[role="toolbar"] button')
    .filter({ hasText: /^终端$/ })
    .first()
    .evaluate((button) => button.click());
  await kanban.waitFor({ state: 'hidden', timeout: VIEW_SWITCH_TIMEOUT_MS });
}

async function showTaskBoard(page) {
  const kanban = page.getByTestId('task-kanban');
  if (await kanban.isVisible().catch(() => false)) {
    return;
  }
  await page.getByTestId('task-board-toggle').click();
  await kanban.waitFor({ timeout: VIEW_SWITCH_TIMEOUT_MS });
}

/** The first panel can be the hidden one in the single-terminal layout. */
function visibleTerminalPanel(page) {
  return page.locator('.terminal-panel').filter({ visible: true }).first();
}

/** Task board: record a task, run it as a real Agent terminal, then accept the result. */
async function recordTaskBoardScene(page, recorder) {
  const boardToggle = page.getByTestId('task-board-toggle');
  await boardToggle.click();
  await page.getByTestId('task-kanban').waitFor();
  await page.waitForTimeout(READING_PAUSE_MS);

  await page.getByTestId('task-create-button').click();
  await page.getByTestId('task-title-input').waitFor();
  await typeLikeAHuman(page.getByTestId('task-title-input'), '给价格计算补一个折扣分支的测试');
  await typeLikeAHuman(
    page.getByTestId('task-description-input'),
    'src/pricing.js 里的满减逻辑还没有测试覆盖，补一个用例。',
  );
  await typeLikeAHuman(
    page.getByTestId('task-acceptance-input'),
    'npm test 通过，且新增用例会失败于旧实现',
  );
  await page.waitForTimeout(SETTLE_MS);

  const executionToggle = page.getByTestId('task-execution-toggle');
  if ((await executionToggle.getAttribute('aria-expanded')) !== 'true') {
    await executionToggle.click();
  }
  await page.waitForTimeout(READING_PAUSE_MS);

  await page.getByTestId('task-save-run-button').click();
  await page.locator('.task-dialog').waitFor({ state: 'detached' });

  // Saving with 执行 keeps the board on screen and starts the Agent terminal behind it, so the
  // card entering 执行中 is the first thing to wait for.
  await page
    .locator('.kanban-column[data-stage="executing"] .task-card')
    .first()
    .waitFor({ timeout: TASK_STAGE_TIMEOUT_MS });
  await page.waitForTimeout(READING_PAUSE_MS);

  // Then show the terminal it created — this is the link between a card and a real Agent.
  await showTerminalView(page);
  await visibleTerminalPanel(page).waitFor({ timeout: TERMINAL_START_TIMEOUT_MS });
  await page.waitForTimeout(READING_PAUSE_MS * 2);

  // Back to the board, where the card can actually be seen moving between columns.
  await showTaskBoard(page);
  await page.waitForTimeout(SETTLE_MS);

  // Skip the unattended stretch: the Agent working is real, but it is minutes of a cursor.
  await recorder.pause();
  const completedCard = page.locator('.kanban-column[data-stage="completed"] .task-card').first();
  const reachedCompletion = await completedCard
    .waitFor({ timeout: TASK_STAGE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  await recorder.resume();

  if (!reachedCompletion) {
    console.warn('  the task did not reach 已完成 within the timeout');
    await page.waitForTimeout(READING_PAUSE_MS);
    return;
  }

  await page.waitForTimeout(READING_PAUSE_MS);
  await acceptCompletedTask(page);
}

/**
 * Human acceptance is the last link in the chain, so the clip should end on it.
 * A finished card carries 验证通过 next to 不通过 / 继续修改; the name is anchored because a
 * loose match on 通过 hits the rejection button first.
 */
async function acceptCompletedTask(page) {
  const completedCard = page.locator('.kanban-column[data-stage="completed"] .task-card').first();
  const passButton = completedCard.getByRole('button', { name: /^验证通过$/ });
  if ((await passButton.count()) === 0) {
    console.warn('  the completed card offered no 验证通过 button');
    return;
  }

  await passButton.click();
  await page
    .locator('.kanban-column[data-stage="verified"] .task-card')
    .first()
    .waitFor({ timeout: ACCEPTANCE_TIMEOUT_MS })
    .catch(() => console.warn('  the task did not reach 已验收'));
  await page.waitForTimeout(READING_PAUSE_MS);
}

/**
 * Workbench: two Agents side by side in a grid, with the status panel reacting.
 *
 * The terminals are started from the task board rather than from the Agent menu. The menu route
 * calls the directory picker, which opens a native Windows folder dialog that no browser
 * automation can drive; a task already carries its working directory, so it starts an Agent
 * without one. The resulting terminals are identical either way.
 */
async function recordWorkbenchScene(page) {
  await startAgentTerminalViaTask(page, '整理 README 的安装步骤', 'claude');
  await startAgentTerminalViaTask(page, '检查依赖是否有安全告警', 'opencode');

  await resetToTerminalView(page);

  // In the single-terminal layout only the active panel is rendered, so the grid comes first —
  // it is what puts both Agents on screen at once, which is the whole point of the scene.
  await page.getByTitle('网格布局').click();
  await page.locator('.terminal-grid[data-layout="grid"]').waitFor();
  await visibleTerminalPanel(page).waitFor({ timeout: TERMINAL_START_TIMEOUT_MS });
  await page.waitForTimeout(READING_PAUSE_MS);

  // Both Agents are already working on their tasks, so the status badges move on their own —
  // typing another prompt here would only interrupt them. Hold on the grid instead, long enough
  // for the badges and the status panel to visibly change.
  await page.waitForTimeout(WORKBENCH_RESPONSE_WINDOW_MS);
}

/** Session centre: search across native sessions and resume one. */
async function recordSessionCenterScene(page) {
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent 会话中心' });
  await dialog.waitFor();

  // The scan reads native transcripts off disk; showing the spinner is not the point of the clip.
  await dialog
    .getByText('正在扫描本机会话')
    .waitFor({ state: 'hidden', timeout: SESSION_SCAN_TIMEOUT_MS })
    .catch(() => console.warn('  the session scan was still running'));
  await page.waitForTimeout(READING_PAUSE_MS);

  // The list itself is the point of this scene, so it is what the clip lingers on.
  // No search term is typed: whether one matches depends on the session titles the Agents
  // happened to write, and a clip that ends on "没有匹配的会话" sells nothing.
  // "仅当前工作区" stays checked on purpose — it keeps the operator's other projects out of frame.
  await page.mouse.move(SESSION_LIST_CENTRE.x, SESSION_LIST_CENTRE.y);
  await page.mouse.wheel(0, SESSION_LIST_SCROLL_PIXELS);
  await page.waitForTimeout(READING_PAUSE_MS);
  await page.mouse.wheel(0, -SESSION_LIST_SCROLL_PIXELS);
  await page.waitForTimeout(READING_PAUSE_MS);

  await dialog.getByRole('button', { name: '关闭' }).first().click();
}

/** Settings: the model and provider profiles that back the switching workflow. */
async function recordModelProfileScene(page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent 与开发环境设置' });
  await dialog.waitFor();
  await page.waitForTimeout(SETTLE_MS);
  await dialog.getByRole('button', { name: '模型 Profile' }).click();
  await page.waitForTimeout(READING_PAUSE_MS * 2);
  await dialog.getByRole('button', { name: '网络与 npm', exact: true }).click();
  await page.waitForTimeout(READING_PAUSE_MS);
  await dialog.getByRole('button', { name: '关闭' }).first().click();
}

/**
 * Records a task for the given Agent and runs it, which starts a real Agent terminal.
 *
 * This is the automatable way to open an Agent terminal: the Agent menu route goes through the
 * directory picker and its native Windows folder dialog, which browser automation cannot answer.
 */
async function startAgentTerminalViaTask(page, title, agentType) {
  const terminalCountBefore = await page.locator('.terminal-panel').count();

  await showTaskBoard(page);
  await page.getByTestId('task-create-button').click();
  await page.getByTestId('task-title-input').waitFor();
  await typeLikeAHuman(page.getByTestId('task-title-input'), title);

  const executionToggle = page.getByTestId('task-execution-toggle');
  if ((await executionToggle.getAttribute('aria-expanded')) !== 'true') {
    await executionToggle.click();
  }
  await selectTaskAgent(page, agentType);
  await page.waitForTimeout(SETTLE_MS);

  await page.getByTestId('task-save-run-button').click();
  await page.locator('.task-dialog').waitFor({ state: 'detached' });
  await page
    .locator('.terminal-panel')
    .nth(terminalCountBefore)
    .waitFor({ state: 'attached', timeout: TERMINAL_START_TIMEOUT_MS });
  await page.waitForTimeout(SETTLE_MS);
}

/** The model options encode their Agent in the value as `${agentType}|${profileId}`. */
async function selectTaskAgent(page, agentType) {
  const modelSelect = page.getByTestId('task-model-select');
  await modelSelect.waitFor();
  const value = await modelSelect
    .locator('option')
    .evaluateAll(
      (options, prefix) => options.map((option) => option.value).find((v) => v.startsWith(prefix)),
      `${agentType}|`,
    );
  if (!value) {
    throw new Error(`the task editor offered no model profile for ${agentType}`);
  }
  await modelSelect.selectOption(value);
}

/** Typing instantly looks synthetic on video; a per-character delay reads as a real person. */
async function typeLikeAHuman(locator, text) {
  await locator.click();
  await locator.pressSequentially(text, { delay: 45 });
}

async function ensureDemoProject() {
  await mkdir(resolve(DEMO_PROJECT_DIRECTORY, 'src'), { recursive: true });
  await writeFile(
    resolve(DEMO_PROJECT_DIRECTORY, 'package.json'),
    `${JSON.stringify(
      { name: 'shop-api', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(DEMO_PROJECT_DIRECTORY, 'src/pricing.js'),
    [
      'export function calculateTotal(items, discount = 0) {',
      '  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);',
      '  return subtotal - discount;',
      '}',
      '',
    ].join('\n'),
  );
  // A repository makes the branch indicator and Git context real rather than blank.
  await initialiseGitRepository();
}

async function initialiseGitRepository() {
  const gitDirectory = resolve(DEMO_PROJECT_DIRECTORY, '.git');
  if (existsSync(gitDirectory)) {
    return;
  }
  const run = (args) =>
    promisify(execFile)('git', args, { cwd: DEMO_PROJECT_DIRECTORY, windowsHide: true });
  await run(['init', '--initial-branch=main']);
  await run(['add', '.']);
  await run([
    '-c',
    'user.name=Termexo Demo',
    '-c',
    'user.email=demo@termexo.local',
    'commit',
    '-m',
    'chore: seed the demo project',
  ]);
}

function readArgument(name) {
  const match = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
