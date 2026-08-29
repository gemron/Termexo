import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from 'playwright-core';

const APP_URL = process.env.TERMEXO_URL ?? 'http://127.0.0.1:4200';
const EDGE_PATH =
  process.env.EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });

/** Execution settings start folded away, so the fields inside need the section opened first. */
const openExecutionSettings = async (page) => {
  const toggle = page.getByTestId('task-execution-toggle');
  await toggle.waitFor();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
};

/** A prompt reaches the PTY as several writes, so delivery outlives the click that starts it. */
const waitForPromptDelivery = (page, title) =>
  page.waitForFunction((taskTitle) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    const workspace = app.state.activeWorkspace();
    const task = app.todos.tasksFor(workspace.id).find((item) => item.title === taskTitle);
    return Boolean(task) && !['pending', 'sending'].includes(task.promptDeliveryState);
  }, title);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('task-board-toggle').click();
  const board = page.getByTestId('task-kanban');
  await board.waitFor();

  const columnStages = await board
    .locator('.kanban-column')
    .evaluateAll((columns) => columns.map((column) => column.getAttribute('data-stage')));
  if (
    JSON.stringify(columnStages) !== JSON.stringify(['todo', 'executing', 'completed', 'verified'])
  ) {
    throw new Error(`unexpected kanban columns: ${JSON.stringify(columnStages)}`);
  }
  if (
    (await board.locator('.kanban-column:not([data-stage="todo"]) button.empty-column').count()) > 0
  ) {
    throw new Error('an empty downstream column still behaved like a task creation button');
  }

  // Closing a dirty editor must offer a deliberate choice and preserve the draft while continuing.
  await page.getByTestId('task-create-button').click();
  await page.getByTestId('task-title-input').fill('尚未保存的任务');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByText('要放弃未保存的修改吗？', { exact: true }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  if ((await page.getByTestId('task-title-input').inputValue()) !== '尚未保存的任务') {
    throw new Error('continuing after the discard warning lost the task draft');
  }
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.task-dialog').waitFor({ state: 'detached' });

  // Record everything Termexo writes to a PTY, so both reuse and new-terminal delivery are visible.
  await page.evaluate(() => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    const gateway = app.terminalGateway;
    const original = gateway.write.bind(gateway);
    globalThis.__termexoWrites = [];
    globalThis.__termexoFailNextWrite = null;
    gateway.write = (session, data) => {
      globalThis.__termexoWrites.push({ terminalId: session.id, data });
      if (
        globalThis.__termexoFailNextWrite?.terminalId === session.id &&
        data.includes(globalThis.__termexoFailNextWrite.title)
      ) {
        globalThis.__termexoFailNextWrite = null;
        return Promise.reject(new Error('模拟终端写入失败'));
      }
      return original(session, data);
    };
    // A prompt only runs when the paste and the Enter reach the PTY as separate writes.
    globalThis.__termexoDelivery = (terminalId, marker) => {
      const writes = globalThis.__termexoWrites.filter((write) => write.terminalId === terminalId);
      const pasted = writes.filter((write) => write.data.includes(marker));
      const last = writes.lastIndexOf(pasted[pasted.length - 1]);
      return {
        submitted: pasted.length,
        clearedBeforePaste: last > 0 && writes[last - 1].data === '\x15',
        submittedWithEnter: last >= 0 && writes[last + 1]?.data === '\r',
      };
    };
  });

  // A newly recorded task can target an Agent terminal that is already open.
  const reusedTaskTitle = '复用已有终端执行任务';
  await page.getByTestId('task-create-button').click();
  await openExecutionSettings(page);
  const terminalSelect = page.getByTestId('task-terminal-select');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="task-terminal-select"] option').length > 1,
  );
  await terminalSelect.selectOption({ index: 1 });
  const reusedTerminalId = await terminalSelect.inputValue();
  if (!reusedTerminalId || reusedTerminalId === 'new') {
    throw new Error('task editor did not expose an existing terminal choice');
  }
  await page.getByTestId('task-terminal-summary').waitFor();
  const terminalPickerScreenshot = join(tmpdir(), 'termexo-todo-terminal-picker.png');
  await page.locator('.task-dialog').screenshot({ path: terminalPickerScreenshot });
  await page.getByTestId('task-title-input').fill(reusedTaskTitle);
  const terminalCountBeforeReuse = await page.evaluate(
    () =>
      globalThis.ng.getComponent(document.querySelector('app-root')).state.activeWorkspace()
        .terminals.length,
  );
  await page.getByTestId('task-save-run-button').click();
  let reusedCard = page
    .locator('.kanban-column[data-stage="executing"] .task-card')
    .filter({ hasText: reusedTaskTitle });
  await reusedCard.waitFor();
  await waitForPromptDelivery(page, reusedTaskTitle);
  const reused = await page.evaluate(
    ({ title, terminalId, terminalCount }) => {
      const app = globalThis.ng.getComponent(document.querySelector('app-root'));
      const workspace = app.state.activeWorkspace();
      const task = app.todos.tasksFor(workspace.id).find((item) => item.title === title);
      return {
        preferredTerminalId: task?.preferredTerminalId,
        terminalId: task?.terminalId,
        terminalCountUnchanged: workspace.terminals.length === terminalCount,
        ...globalThis.__termexoDelivery(terminalId, title),
        deliveryState: task?.promptDeliveryState,
        deliveredAt: task?.promptDeliveredAt,
      };
    },
    {
      title: reusedTaskTitle,
      terminalId: reusedTerminalId,
      terminalCount: terminalCountBeforeReuse,
    },
  );
  if (
    reused.preferredTerminalId !== reusedTerminalId ||
    reused.terminalId !== reusedTerminalId ||
    !reused.terminalCountUnchanged ||
    reused.submitted !== 1 ||
    !reused.clearedBeforePaste ||
    !reused.submittedWithEnter ||
    reused.deliveryState !== 'delivered' ||
    !reused.deliveredAt
  ) {
    throw new Error(`existing terminal was not reused: ${JSON.stringify(reused)}`);
  }

  // The execution card states its run in one place: a state-coloured rail and a live clock, and
  // when a person is what the agent waits on, a call to action instead of another status word.
  await reusedCard.locator('.run-rail[data-rail="active"]').waitFor();
  const elapsedReading = (await reusedCard.locator('.run-elapsed').innerText()).trim();
  if (!/^[0-9]+ (秒|分)$/.test(elapsedReading)) {
    throw new Error(`the run clock did not read as a duration: ${elapsedReading}`);
  }
  if ((await reusedCard.getByRole('button', { name: '前往处理', exact: true }).count()) !== 0) {
    throw new Error('a running task already showed the call to action meant for a blocked one');
  }

  await page.evaluate((terminalId) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    app.handleTerminalStatus({ terminalId, status: 'WAITING_APPROVAL' });
  }, reusedTerminalId);
  await reusedCard.locator('.run-rail[data-rail="waiting"]').waitFor();
  await reusedCard.getByRole('button', { name: '前往处理', exact: true }).waitFor();
  const attention = await reusedCard.evaluate((element) => ({
    run: element.getAttribute('data-run'),
    flagged: element.classList.contains('needs-attention'),
  }));
  if (attention.run !== 'waiting' || !attention.flagged) {
    throw new Error(`a blocked task was not flagged for attention: ${JSON.stringify(attention)}`);
  }

  await page.evaluate((terminalId) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    app.handleTerminalStatus({ terminalId, status: 'RUNNING' });
  }, reusedTerminalId);
  await reusedCard.locator('.run-rail[data-rail="active"]').waitFor();
  await reusedCard.getByRole('button', { name: '编辑待办', exact: true }).click();
  await openExecutionSettings(page);
  if (!(await page.getByTestId('task-terminal-select').isDisabled())) {
    throw new Error('an executing task allowed its terminal binding to be changed');
  }
  if ((await page.getByRole('button', { name: '删除任务', exact: true }).count()) !== 0) {
    throw new Error('an executing task exposed deletion while its terminal was still active');
  }
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate((title) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    const workspace = app.state.activeWorkspace();
    const task = app.todos.tasksFor(workspace.id).find((item) => item.title === title);
    if (task) app.todos.markCompleted(task.id);
  }, reusedTaskTitle);
  reusedCard = page
    .locator('.kanban-column[data-stage="completed"] .task-card')
    .filter({ hasText: reusedTaskTitle });
  await reusedCard.getByRole('button', { name: '编辑待办', exact: true }).click();
  await page.getByRole('button', { name: '删除任务', exact: true }).click();
  await page.getByRole('button', { name: '再次点击确认删除', exact: true }).click();
  await reusedCard.waitFor({ state: 'detached' });

  // A failed write remains bound to the same live terminal and can be delivered on retry.
  const retriedTaskTitle = '终端写入失败后重新发送';
  await page.evaluate((terminalId) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    app.state.updateTerminalStatus(terminalId, 'IDLE');
  }, reusedTerminalId);
  await page.getByTestId('task-create-button').click();
  await openExecutionSettings(page);
  await page.getByTestId('task-terminal-select').selectOption(reusedTerminalId);
  await page.getByTestId('task-title-input').fill(retriedTaskTitle);
  await page.evaluate(
    ({ terminalId, title }) => {
      globalThis.__termexoFailNextWrite = { terminalId, title };
    },
    { terminalId: reusedTerminalId, title: retriedTaskTitle },
  );
  await page.getByTestId('task-save-run-button').click();
  let retriedCard = page.locator('.task-card').filter({ hasText: retriedTaskTitle });
  await retriedCard.getByText('任务未送达终端', { exact: true }).waitFor();
  await retriedCard.getByRole('button', { name: '重新发送', exact: true }).click();
  await waitForPromptDelivery(page, retriedTaskTitle);
  const retried = await page.evaluate(
    ({ terminalId, title }) => {
      const app = globalThis.ng.getComponent(document.querySelector('app-root'));
      const workspace = app.state.activeWorkspace();
      const task = app.todos.tasksFor(workspace.id).find((item) => item.title === title);
      return {
        terminalId: task?.terminalId,
        attempts: task?.attempts,
        deliveryState: task?.promptDeliveryState,
        ...globalThis.__termexoDelivery(terminalId, title),
      };
    },
    { terminalId: reusedTerminalId, title: retriedTaskTitle },
  );
  if (
    retried.terminalId !== reusedTerminalId ||
    retried.attempts !== 2 ||
    retried.deliveryState !== 'delivered' ||
    retried.submitted !== 2 ||
    !retried.submittedWithEnter
  ) {
    throw new Error(`failed task was not redelivered to its terminal: ${JSON.stringify(retried)}`);
  }
  // A run can be called off from the card: the agent is interrupted and the task waits in 待办
  // instead of being stranded in an execution nobody is watching.
  const writesBeforeStop = await page.evaluate(() => globalThis.__termexoWrites.length);
  await retriedCard.getByTestId('task-stop-button').click();
  retriedCard = page
    .locator('.kanban-column[data-stage="todo"] .task-card')
    .filter({ hasText: retriedTaskTitle });
  await retriedCard.locator('.stopped-note').waitFor();
  const stopped = await page.evaluate(
    ({ title, terminalId, writeCount }) => {
      const app = globalThis.ng.getComponent(document.querySelector('app-root'));
      const workspace = app.state.activeWorkspace();
      const task = app.todos.tasksFor(workspace.id).find((item) => item.title === title);
      return {
        stage: task?.stage,
        executionState: task?.executionState,
        terminalId: task?.terminalId,
        attempts: task?.attempts,
        interrupted: globalThis.__termexoWrites
          .slice(writeCount)
          .some((write) => write.terminalId === terminalId && write.data === '\x1b'),
      };
    },
    { title: retriedTaskTitle, terminalId: reusedTerminalId, writeCount: writesBeforeStop },
  );
  if (
    stopped.stage !== 'todo' ||
    stopped.executionState !== 'idle' ||
    stopped.terminalId !== undefined ||
    stopped.attempts !== 2 ||
    !stopped.interrupted
  ) {
    throw new Error(`stopping a task did not release its run: ${JSON.stringify(stopped)}`);
  }

  // Deleting from the card asks once on the card itself, so no dialog has to be opened for it.
  await retriedCard.getByTestId('task-card-delete').click();
  await retriedCard.getByText('删除这个任务？', { exact: true }).waitFor();
  await retriedCard.getByRole('button', { name: '取消', exact: true }).click();
  await retriedCard.getByText('删除这个任务？', { exact: true }).waitFor({ state: 'detached' });
  await retriedCard.getByTestId('task-card-delete').click();
  await retriedCard.getByTestId('task-card-delete-confirm').click();
  await retriedCard.waitFor({ state: 'detached' });

  const projectDirectory = 'D:\\devlop\\Termexo\\apps\\desktop-ui';
  const movedProjectDirectory = 'D:\\devlop\\Termexo\\apps';
  const taskDirectory = 'D:\\devlop\\Termexo\\src-tauri';

  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByTestId('project-name-input').fill('桌面端');
  await page.getByTestId('project-directory-input').fill(projectDirectory);
  await page.getByTestId('project-save-button').click();
  await page.locator('.project-switcher button.active').filter({ hasText: '桌面端' }).waitFor();

  await page.getByTestId('task-create-button').click();
  await openExecutionSettings(page);
  const prefilledDirectory = await page.getByTestId('task-directory-input').inputValue();
  if (prefilledDirectory !== projectDirectory) {
    throw new Error(`task editor did not inherit the project directory: ${prefilledDirectory}`);
  }
  await page.getByTestId('task-directory-input').fill(taskDirectory);
  await page.getByTestId('task-title-input').fill('完成任务看板端到端流程');
  await page
    .getByTestId('task-description-input')
    .fill('实现拖拽执行、终端详情、完成验收和失败后继续会话。');
  await page.getByTestId('task-acceptance-input').fill('任务状态完整流转，刷新后数据仍然存在。');
  const modelOptions = page.getByTestId('task-model-select').locator('option');
  if ((await modelOptions.count()) < 2) {
    throw new Error('task editor did not list both Claude and Codex model choices');
  }
  const codexValue = await page
    .getByTestId('task-model-select')
    .locator('option')
    .filter({ hasText: 'Codex' })
    .first()
    .getAttribute('value');
  if (!codexValue) throw new Error('Codex model option is missing a value');
  await page.getByTestId('task-model-select').selectOption(codexValue);
  await page.getByTestId('task-save-button').click();

  const title = '完成任务看板端到端流程';
  let card = page.locator('.task-card').filter({ hasText: title });
  await card.waitFor();
  const todoColumn = page.locator('.kanban-column[data-stage="todo"]');
  const executingColumn = page.locator('.kanban-column[data-stage="executing"]');
  const completedColumn = page.locator('.kanban-column[data-stage="completed"]');
  const verifiedColumn = page.locator('.kanban-column[data-stage="verified"]');
  if ((await todoColumn.locator('.task-card').count()) !== 1) {
    throw new Error('new task was not created in the todo column');
  }

  if ((await card.locator('.task-directory').innerText()).trim() !== taskDirectory) {
    throw new Error('task card did not show the directory chosen for the task');
  }

  await card.dragTo(executingColumn);
  card = executingColumn.locator('.task-card').filter({ hasText: title });
  await card.waitFor();
  await card.getByRole('button', { name: '查看关联终端', exact: true }).click();
  await page.locator('.terminal-panel.active').filter({ hasText: title }).waitFor();

  // The agent prompt is delivered by Termexo, not typed, so it has to reach the PTY on its own.
  const launched = await page.evaluate(async () => {
    const app = globalThis.ng?.getComponent(document.querySelector('app-root'));
    const workspace = app?.state?.activeWorkspace?.();
    const task = app?.todos
      ?.tasksFor?.(workspace.id)
      ?.find((item) => item.title === '完成任务看板端到端流程');
    const terminal = workspace?.terminals.find((item) => item.id === task?.terminalId);
    for (let attempt = 0; attempt < 60 && app.agentStartup.awaitingTerminalIds().length > 0;) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempt += 1;
    }
    const deliveredTask = app?.todos
      ?.tasksFor?.(workspace.id)
      ?.find((item) => item.id === task?.id);
    return {
      workingDirectory: terminal?.workingDirectory,
      ...globalThis.__termexoDelivery(terminal?.id, 'Termexo 任务看板'),
      deliveryState: deliveredTask?.promptDeliveryState,
      deliveredAt: deliveredTask?.promptDeliveredAt,
    };
  });
  if (launched.workingDirectory !== taskDirectory) {
    throw new Error(
      `agent terminal did not start in the chosen directory: ${JSON.stringify(launched)}`,
    );
  }
  // The emulated PTY replays the writes the desktop app sends, so the prompt has to be readable.
  await page
    .locator('.terminal-panel.active .xterm-rows')
    .filter({ hasText: 'Termexo 任务看板' })
    .waitFor();
  if (
    launched.submitted !== 1 ||
    !launched.clearedBeforePaste ||
    !launched.submittedWithEnter ||
    launched.deliveryState !== 'delivered' ||
    !launched.deliveredAt
  ) {
    throw new Error(`the task prompt was not auto-submitted: ${JSON.stringify(launched)}`);
  }
  // A folder-trust dialog has to be answered before the prompt, otherwise the terminal stalls.
  const startupOrder = await page.evaluate(async () => {
    const app = globalThis.ng?.getComponent(document.querySelector('app-root'));
    const calls = [];
    app.agentStartup.arm('smoke-startup-terminal', {
      confirm: async () => void calls.push('confirm'),
      submit: async () => void calls.push('submit'),
      onFailed: (message) => calls.push(`failed:${message}`),
    });
    // Nothing is timed until the PTY reports RUNNING, exactly as a real launch does.
    app.handleTerminalStatus({ terminalId: 'smoke-startup-terminal', status: 'RUNNING' });
    const feed = (data) => app.handleTerminalOutput({ terminalId: 'smoke-startup-terminal', data });
    feed(
      [
        'Quick safety check: Is this a project you created or one you trust?',
        "Claude Code'll be able to read, edit, and execute files here.",
        '❯ 1. Yes, I trust this folder',
        '  2. No, exit',
      ].join('\n'),
    );
    await new Promise((resolve) => setTimeout(resolve, 2200));
    feed('\n> \n  ? for shortcuts');
    await new Promise((resolve) => setTimeout(resolve, 2200));
    return calls;
  });
  if (JSON.stringify(startupOrder) !== JSON.stringify(['confirm', 'submit'])) {
    throw new Error(
      `startup dialog was not answered before the prompt: ${JSON.stringify(startupOrder)}`,
    );
  }

  await page.getByTestId('task-board-toggle').click();
  await board.waitFor();
  const firstExecution = await page.evaluate(() => {
    const root = document.querySelector('app-root');
    const app = root && globalThis.ng?.getComponent(root);
    const workspace = app?.state?.activeWorkspace?.();
    const task =
      workspace &&
      app?.todos?.tasksFor?.(workspace.id)?.find((item) => item.title === '完成任务看板端到端流程');
    if (!app || !task?.terminalId) return null;
    app.todos.applyAgentEvent({
      eventKey: 'todo-smoke-complete-1',
      agentType: task.agentType,
      nativeSessionId: 'todo-smoke-native-session',
      terminalId: task.terminalId,
      eventType: 'task.completed',
      detail: {},
      createdAt: Date.now(),
    });
    return { terminalId: task.terminalId, taskId: task.id };
  });
  if (!firstExecution) throw new Error('could not simulate the Agent completion hook');
  card = completedColumn.locator('.task-card').filter({ hasText: title });
  await card.waitFor();

  await card.getByRole('button', { name: '不通过 / 继续修改', exact: true }).click();
  await page.getByTestId('validation-feedback-input').fill('窄屏下最后一列被截断，请修复布局。');
  await page.getByTestId('validation-continue-button').click();
  card = executingColumn.locator('.task-card').filter({ hasText: title });
  await card.waitFor();
  await card.getByText('第 2 次', { exact: true }).waitFor();

  const resumed = await page.evaluate(() => {
    const root = document.querySelector('app-root');
    const app = root && globalThis.ng?.getComponent(root);
    const workspace = app?.state?.activeWorkspace?.();
    const task =
      workspace &&
      app?.todos?.tasksFor?.(workspace.id)?.find((item) => item.title === '完成任务看板端到端流程');
    if (!app || !task) return null;
    app.todos.applyAgentEvent({
      eventKey: 'todo-smoke-complete-2',
      agentType: task.agentType,
      nativeSessionId: task.nativeSessionId,
      terminalId: task.terminalId,
      eventType: 'task.completed',
      detail: {},
      createdAt: Date.now(),
    });
    return {
      attempts: task.attempts,
      nativeSessionId: task.nativeSessionId,
      failedValidations: task.validations.filter((item) => item.outcome === 'failed').length,
    };
  });
  if (
    !resumed ||
    resumed.attempts !== 2 ||
    resumed.nativeSessionId !== 'todo-smoke-native-session' ||
    resumed.failedValidations !== 1
  ) {
    throw new Error(`task did not continue the bound session: ${JSON.stringify(resumed)}`);
  }

  card = completedColumn.locator('.task-card').filter({ hasText: title });
  await card.waitFor();
  await card.dragTo(verifiedColumn);
  card = verifiedColumn.locator('.task-card').filter({ hasText: title });
  await card.waitFor();
  await card.getByText('已验收', { exact: true }).waitFor();

  await page
    .locator('.project-chip')
    .filter({ hasText: '桌面端' })
    .getByTestId('project-edit-button')
    .click();
  await page.getByTestId('project-directory-input').fill(movedProjectDirectory);
  await page.getByTestId('project-save-button').click();
  await page.locator('.project-dialog').waitFor({ state: 'detached' });
  const directories = await page.evaluate(() => {
    const app = globalThis.ng?.getComponent(document.querySelector('app-root'));
    const workspace = app?.state?.activeWorkspace?.();
    const project = app?.todos?.projectsFor?.(workspace.id)?.find((item) => item.name === '桌面端');
    const task = app?.todos
      ?.tasksFor?.(workspace.id)
      ?.find((item) => item.title === '完成任务看板端到端流程');
    return { projectPath: project?.path, taskDirectory: task?.workingDirectory };
  });
  if (
    directories.projectPath !== 'D:\\devlop\\Termexo\\apps' ||
    directories.taskDirectory !== 'D:\\devlop\\Termexo\\src-tauri'
  ) {
    throw new Error(`editing the project directory went wrong: ${JSON.stringify(directories)}`);
  }

  // A project that still owns tasks must explain itself instead of silently dropping that work.
  await page
    .locator('.project-chip')
    .filter({ hasText: '桌面端' })
    .getByTestId('project-edit-button')
    .click();
  if ((await page.getByTestId('project-delete-button').count()) !== 0) {
    throw new Error('a project holding tasks still offered deletion');
  }
  await page.getByText('该项目下仍有任务，请先删除或改派这些任务。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.project-dialog').waitFor({ state: 'detached' });

  // An empty project can be removed, and the board falls back to showing every project.
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByTestId('project-name-input').fill('临时项目');
  await page.getByTestId('project-directory-input').fill('D:\devlop\Termexo');
  await page.getByTestId('project-save-button').click();
  await page.locator('.project-switcher button.active').filter({ hasText: '临时项目' }).waitFor();
  await page
    .locator('.project-chip')
    .filter({ hasText: '临时项目' })
    .getByTestId('project-edit-button')
    .click();
  await page.getByTestId('project-delete-button').click();
  await page.getByRole('button', { name: '再次点击确认删除', exact: true }).click();
  await page.locator('.project-dialog').waitFor({ state: 'detached' });
  await page
    .locator('.project-chip')
    .filter({ hasText: '临时项目' })
    .waitFor({ state: 'detached' });
  const afterProjectDelete = await page.evaluate(() => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    const workspace = app.state.activeWorkspace();
    return {
      projects: app.todos.projectsFor(workspace.id).map((item) => item.name),
      tasksKept: app.todos.tasksFor(workspace.id).length,
    };
  });
  if (afterProjectDelete.projects.includes('临时项目') || afterProjectDelete.tasksKept === 0) {
    throw new Error(`deleting an empty project went wrong: ${JSON.stringify(afterProjectDelete)}`);
  }

  // A prompt still in flight when the app restarts has nothing left to deliver it, so the board
  // has to surface it as a failure the user can resend rather than a permanent "waiting to send".
  const interrupted = await page.evaluate(() => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    const workspace = app.state.activeWorkspace();
    const terminal = workspace.terminals[0];
    const project = app.todos.projectsFor(workspace.id)[0];
    const task = app.todos.createTask(workspace.id, {
      projectId: project.id,
      title: '重启后仍未送达的任务',
      description: '',
      acceptanceCriteria: '',
      priority: 'medium',
      workingDirectory: '',
      agentType: terminal.agentType,
      profileId: terminal.profileId ?? '',
      modelName: terminal.model ?? '',
    });
    app.todos.beginExecution(task.id, { terminalId: terminal.id });
    app.todos.markPromptSending(task.id, terminal.id);
    // Exactly what startup does once the workspaces and their terminals are back.
    app.todos.reconcileTerminals(app.state.workspaces());
    const recovered = app.todos.task(task.id);
    return {
      taskId: task.id,
      stage: recovered.stage,
      executionState: recovered.executionState,
      promptDeliveryState: recovered.promptDeliveryState,
      lastError: recovered.lastError,
    };
  });
  const interruptedCard = page.locator('.task-card').filter({ hasText: '重启后仍未送达的任务' });
  await interruptedCard.getByRole('button', { name: '重新发送', exact: true }).waitFor();
  if (
    interrupted.executionState !== 'failed' ||
    interrupted.promptDeliveryState !== 'failed' ||
    interrupted.lastError !== '任务指令未送达终端，请重新发送。'
  ) {
    throw new Error(`interrupted prompt was not recovered: ${JSON.stringify(interrupted)}`);
  }
  await page.evaluate((taskId) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    app.todos.deleteTask(taskId);
  }, interrupted.taskId);
  await interruptedCard.waitFor({ state: 'detached' });

  // 常用任务 (编译 / 打包 / 发布) are the ones that run again and again, so a finished run has to
  // hand the card back instead of archiving it, and starting the next run must take a single click.
  const routineTitle = '编译';
  await page.getByTestId('task-create-button').click();
  await page.locator('[data-preset="build"]').click();
  // The preset fills signals, so the inputs only carry the values after the next render.
  await page.waitForFunction(
    (title) => document.querySelector('[data-testid="task-title-input"]')?.value === title,
    routineTitle,
  );
  const preset = await page.evaluate(() => ({
    title: document.querySelector('[data-testid="task-title-input"]').value,
    description: document.querySelector('[data-testid="task-description-input"]').value,
    recurring: document.querySelector('[data-testid="task-recurring-input"]').checked,
  }));
  if (preset.title !== routineTitle || !preset.description || !preset.recurring) {
    throw new Error(`the 编译 preset did not fill a 常用任务: ${JSON.stringify(preset)}`);
  }
  await page.getByTestId('task-save-button').click();
  await page.locator('.task-dialog').waitFor({ state: 'detached' });

  const routineChip = page.getByTestId('routine-run-button').filter({ hasText: routineTitle });
  await routineChip.waitFor();
  await routineChip.click();
  let routineCard = executingColumn.locator('.task-card').filter({ hasText: routineTitle });
  await routineCard.waitFor();
  await waitForPromptDelivery(page, routineTitle);
  const firstRun = await page.evaluate((title) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    const workspace = app.state.activeWorkspace();
    const task = app.todos.tasksFor(workspace.id).find((item) => item.title === title);
    app.todos.markCompleted(task.id);
    app.todos.verifyTask(task.id, '构建产物已确认');
    return { terminalId: task.terminalId, runCount: task.runCount, attempts: task.attempts };
  }, routineTitle);
  if (firstRun.runCount !== 0 || firstRun.attempts !== 1 || !firstRun.terminalId) {
    throw new Error(`the first 常用任务 run was not recorded: ${JSON.stringify(firstRun)}`);
  }

  routineCard = verifiedColumn.locator('.task-card').filter({ hasText: routineTitle });
  await routineCard.getByTestId('task-rerun-button').click();
  routineCard = executingColumn.locator('.task-card').filter({ hasText: routineTitle });
  await routineCard.waitFor();
  await waitForPromptDelivery(page, routineTitle);
  const secondRun = await page.evaluate(
    ({ title, previousTerminalId }) => {
      const app = globalThis.ng.getComponent(document.querySelector('app-root'));
      const workspace = app.state.activeWorkspace();
      const task = app.todos.tasksFor(workspace.id).find((item) => item.title === title);
      return {
        stage: task.stage,
        runCount: task.runCount,
        attempts: task.attempts,
        recurring: task.recurring,
        validationsKept: task.validations.length,
        ownTerminal: Boolean(task.terminalId) && task.terminalId !== previousTerminalId,
        deliveryState: task.promptDeliveryState,
      };
    },
    { title: routineTitle, previousTerminalId: firstRun.terminalId },
  );
  if (
    secondRun.stage !== 'executing' ||
    secondRun.runCount !== 1 ||
    secondRun.attempts !== 1 ||
    !secondRun.recurring ||
    secondRun.validationsKept !== 1 ||
    !secondRun.ownTerminal ||
    secondRun.deliveryState !== 'delivered'
  ) {
    throw new Error(`the 常用任务 did not start a clean second run: ${JSON.stringify(secondRun)}`);
  }
  await page.evaluate((title) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    const workspace = app.state.activeWorkspace();
    const task = app.todos.tasksFor(workspace.id).find((item) => item.title === title);
    app.todos.markCompleted(task.id);
  }, routineTitle);
  const routineCompletedCard = completedColumn
    .locator('.task-card')
    .filter({ hasText: routineTitle });
  await routineCompletedCard.getByTestId('task-rerun-button').waitFor();

  // 验收时可以顺手关掉跑完的终端，否则常用任务反复执行会在标签栏留下一排空闲终端。
  const routineTerminalId = await page.evaluate((title) => {
    const app = globalThis.ng.getComponent(document.querySelector('app-root'));
    const workspace = app.state.activeWorkspace();
    return app.todos.tasksFor(workspace.id).find((item) => item.title === title)?.terminalId;
  }, routineTitle);
  await routineCompletedCard.getByTestId('task-verify-close-terminal').click();
  await verifiedColumn.locator('.task-card').filter({ hasText: routineTitle }).waitFor();
  const releasedRun = await page.evaluate(
    ({ title, terminalId }) => {
      const app = globalThis.ng.getComponent(document.querySelector('app-root'));
      const workspace = app.state.activeWorkspace();
      const task = app.todos.tasksFor(workspace.id).find((item) => item.title === title);
      return {
        stage: task.stage,
        terminalOpen: workspace.terminals.some((terminal) => terminal.id === terminalId),
        remainingTerminals: workspace.terminals.length,
      };
    },
    { title: routineTitle, terminalId: routineTerminalId },
  );
  if (!routineTerminalId || releasedRun.stage !== 'verified' || releasedRun.terminalOpen) {
    throw new Error(`验收并关闭终端 did not release the run: ${JSON.stringify(releasedRun)}`);
  }

  await page.setViewportSize({ width: 900, height: 650 });
  await page.waitForTimeout(180);
  const layout = await page.evaluate(() => {
    const board = document.querySelector('.todo-board');
    const kanban = document.querySelector('.kanban');
    const rect = board?.getBoundingClientRect();
    return {
      documentOverflowX:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      boardInsideViewport: Boolean(
        rect &&
        rect.left >= 0 &&
        rect.right <= innerWidth &&
        rect.top >= 0 &&
        rect.bottom <= innerHeight,
      ),
      kanbanScrollable: Boolean(kanban && kanban.scrollWidth >= kanban.clientWidth),
    };
  });
  if (layout.documentOverflowX || !layout.boardInsideViewport || !layout.kanbanScrollable) {
    throw new Error(`compact board layout is invalid: ${JSON.stringify(layout)}`);
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('task-board-toggle').click();
  await page
    .locator('.kanban-column[data-stage="verified"] .task-card')
    .filter({ hasText: title })
    .waitFor();
  const persisted = await page.evaluate(() => {
    const raw = localStorage.getItem('termexo.todos.v1');
    return raw ? JSON.parse(raw) : null;
  });
  const persistedTasks = Object.values(persisted ?? {}).flatMap((snapshot) => snapshot.tasks ?? []);
  const persistedTask = persistedTasks.find((task) => task.title === title);
  if (
    !persistedTask ||
    persistedTask.stage !== 'verified' ||
    persistedTask.attempts !== 2 ||
    persistedTask.validations.length !== 2 ||
    persistedTask.promptDeliveryState !== 'delivered'
  ) {
    throw new Error(`verified task was not persisted: ${JSON.stringify(persistedTask)}`);
  }
  const persistedRoutine = persistedTasks.find((task) => task.title === routineTitle);
  if (!persistedRoutine?.recurring || persistedRoutine.runCount !== 1) {
    throw new Error(`常用任务 was not persisted: ${JSON.stringify(persistedRoutine)}`);
  }
  await page.getByTestId('routine-run-button').filter({ hasText: routineTitle }).waitFor();

  // The board view hides the tab strip, and its grid row collapses to zero height. The waiting
  // banner has to keep its own row instead of sliding up under the topbar.
  await page.evaluate(() => {
    const app = globalThis.ng?.getComponent(document.querySelector('app-root'));
    const terminal = app?.state?.activeWorkspace?.()?.terminals?.[0];
    if (terminal) app.state.updateTerminalStatus(terminal.id, 'WAITING_APPROVAL');
  });
  await page.locator('.attention-banner').waitFor();
  await page.waitForTimeout(180);
  const attentionLayout = await page.evaluate(() => {
    const bounds = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const topbar = bounds('.topbar');
    const banner = bounds('.attention-banner');
    const workbench = bounds('.workbench-area');
    const text = document.querySelector('.attention-banner-text');
    return {
      clearsTopbar: Boolean(topbar && banner && banner.top >= topbar.bottom),
      clearsWorkbench: Boolean(workbench && banner && banner.bottom <= workbench.top),
      containsText: Boolean(
        text &&
        banner &&
        text.getBoundingClientRect().top >= banner.top &&
        text.getBoundingClientRect().bottom <= banner.bottom,
      ),
      bannerHeight: banner ? Math.round(banner.height) : 0,
    };
  });
  if (
    !attentionLayout.clearsTopbar ||
    !attentionLayout.clearsWorkbench ||
    !attentionLayout.containsText
  ) {
    throw new Error(`waiting banner is clipped on the board: ${JSON.stringify(attentionLayout)}`);
  }

  const screenshot = join(tmpdir(), 'termexo-todo-board.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  if (errors.length > 0) throw new Error(`browser errors:\n${errors.join('\n')}`);

  console.log(
    JSON.stringify({
      projectCount: await page.locator('.project-switcher .project-chip').count(),
      finalStage: persistedTask.stage,
      attempts: persistedTask.attempts,
      validations: persistedTask.validations.map((item) => item.outcome),
      nativeSessionId: persistedTask.nativeSessionId,
      workingDirectory: persistedTask.workingDirectory,
      reusedTerminal: reused,
      redeliveredTerminal: retried,
      terminalPickerScreenshot,
      promptDelivery: launched,
      startupOrder,
      runIndicator: { elapsedReading, attention },
      routineRuns: { first: firstRun, second: secondRun, persisted: persistedRoutine },
      compactLayout: layout,
      projectsAfterDelete: afterProjectDelete.projects,
      interruptedPromptRecovery: interrupted,
      attentionLayout,
      screenshot,
    }),
  );
} finally {
  await browser.close();
}
