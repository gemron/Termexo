import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { I18nService } from '../core/i18n/i18n.service';
import type { TodoTask, TodoTaskDraft } from '../core/models/todo.models';
import type { TerminalSession, Workspace } from '../core/models/workspace.models';
import { TodoService } from '../core/services/todo.service';
import { TodoBoardComponent } from './todo-board';

const WORKSPACE: Workspace = {
  id: 'workspace-1',
  name: 'Termexo',
  projectPath: 'D:\devlop\Termexo',
  projectType: 'Local project',
  activeBranch: 'main',
  favorite: false,
  lastOpenedAt: 1,
  layout: 'single',
  terminals: [],
};

const TERMINAL: TerminalSession = {
  id: 'terminal-1',
  name: 'Codex · 看板任务',
  workingDirectory: WORKSPACE.projectPath,
  shell: 'powershell',
  agentType: 'codex',
  status: 'COMPLETED',
  model: 'gpt-5.6-sol',
  branch: 'main',
  profileId: 'codex-default',
};

const VERIFY_BUTTON = '[data-testid="task-verify-button"]';
const MORE_BUTTON = '[data-testid="task-more-button"]';
// Inside an open "more" menu; the entry's button is the menuitem keyed by a stable test-id
// derived from the action's translation key.
function moreMenuItem(labelKey: string): string {
  return `[data-testid="task-more-menu"] button[data-action-key="${labelKey}"]`;
}

function openMoreMenu(host: {
  root: HTMLElement;
  fixture: ComponentFixture<TodoBoardComponent>;
}): void {
  const button = host.root.querySelector<HTMLButtonElement>(MORE_BUTTON);
  expect(button).toBeTruthy();
  button!.click();
  host.fixture.detectChanges();
}

function draft(projectId: string, title: string): TodoTaskDraft {
  return {
    projectId,
    title,
    description: '支持验收后关闭终端',
    acceptanceCriteria: '单元测试通过',
    priority: 'high',
    workingDirectory: '',
    agentType: 'codex',
    profileId: 'codex-default',
    modelName: 'gpt-5.6-sol',
  };
}

describe('TodoBoardComponent verification', () => {
  let fixture: ComponentFixture<TodoBoardComponent>;
  let root: HTMLElement;
  let todos: TodoService;
  let projectId: string;
  let closedTerminalIds: string[];

  /** Puts a task in 已完成, optionally bound to a terminal, which is where 验收 starts from. */
  function completedTask(title: string, terminalId?: string): TodoTask {
    const task = todos.createTask(WORKSPACE.id, draft(projectId, title))!;
    if (terminalId) todos.beginExecution(task.id, { terminalId });
    return todos.markCompleted(task.id)!;
  }

  async function render(terminals: TerminalSession[]): Promise<void> {
    fixture = TestBed.createComponent(TodoBoardComponent);
    root = fixture.nativeElement as HTMLElement;
    closedTerminalIds = [];
    fixture.componentInstance.terminalCloseRequested.subscribe((terminalId) =>
      closedTerminalIds.push(terminalId),
    );
    fixture.componentRef.setInput('workspace', WORKSPACE);
    fixture.componentRef.setInput('terminals', terminals);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function click(selector: string): void {
    const button = root.querySelector<HTMLButtonElement>(selector);
    expect(button).toBeTruthy();
    button!.click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    window.localStorage.clear();
    await TestBed.configureTestingModule({ imports: [TodoBoardComponent] }).compileComponents();
    todos = TestBed.inject(TodoService);
    todos.initialize([WORKSPACE]);
    projectId = todos.projectsFor(WORKSPACE.id)[0].id;
  });

  it('creates a Grok task without a Termexo model profile', async () => {
    await render([]);
    fixture.componentRef.setInput('grokAvailable', true);
    fixture.detectChanges();
    click('[data-testid="task-create-button"]');
    click('.settings-toggle');

    const title = root.querySelector<HTMLInputElement>('[data-testid="task-title-input"]')!;
    title.value = 'Review the parser';
    title.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const selection = root.querySelector<HTMLSelectElement>('[data-testid="task-model-select"]')!;
    expect(selection.querySelector('option[value="grok|"]')).toBeTruthy();
    selection.value = 'grok|';
    selection.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const model = root.querySelector<HTMLInputElement>('[data-testid="task-grok-model"]')!;
    model.value = 'grok-build';
    model.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    click('[data-testid="task-save-button"]');

    expect(todos.tasksFor(WORKSPACE.id)).toEqual([
      expect.objectContaining({
        agentType: 'grok',
        profileId: '',
        modelName: 'grok-build',
        title: 'Review the parser',
      }),
    ]);
  });

  it.each([undefined, TERMINAL.id, 'missing-terminal'])(
    'describes the configured terminal in an unstarted task detail (%s)',
    async (preferredTerminalId) => {
      todos.createTask(WORKSPACE.id, {
        ...draft(projectId, 'Task awaiting execution'),
        preferredTerminalId,
      });
      await render([TERMINAL]);
      click('.task-card h3 button');
      const i18n = TestBed.inject(I18nService);
      const detail = root.querySelector('.task-detail-settings')!;
      expect(detail.querySelector('dt')?.textContent?.trim()).toBe(
        i18n.t('taskBoard.priority.label'),
      );
      const label =
        preferredTerminalId === TERMINAL.id
          ? TERMINAL.name
          : i18n.t(
              preferredTerminalId
                ? 'taskBoard.card.terminalUnavailable'
                : 'taskBoard.taskDialog.newTerminalOption',
            );
      expect(detail.textContent).toContain(label);
      expect(detail.textContent).not.toContain('taskBoard.taskDialog.priorityLabel');
    },
  );

  it('offers continuing or dropping a stopped run, and amending a live one', async () => {
    const task = todos.createTask(WORKSPACE.id, draft(projectId, '可中止的任务'))!;
    todos.beginExecution(task.id, { terminalId: TERMINAL.id });
    await render([TERMINAL]);

    // A live run can be interrupted or given more to do, but not resumed — it never stopped.
    expect(root.querySelector('[data-testid="task-stop-button"]')).toBeTruthy();
    openMoreMenu({ root, fixture });
    expect(root.querySelector(moreMenuItem('taskBoard.amend'))).toBeTruthy();
    expect(root.querySelector(moreMenuItem('taskBoard.card.stop'))).toBeNull();
    expect(root.querySelector('[data-testid="task-resume-button"]')).toBeNull();

    const resumed: string[] = [];
    const dropped: string[] = [];
    fixture.componentInstance.resumeRequested.subscribe((id) => resumed.push(id));
    fixture.componentInstance.backlogRequested.subscribe((id) => dropped.push(id));

    todos.stopExecution(task.id);
    fixture.detectChanges();

    // Stopping keeps the run, so both ways out of it are offered and neither is forced.
    // The "stop" primary button disappears (the run is already stopped); "amend" also goes
    // away because a stopped agent no longer accepts new instructions.
    expect(root.querySelector('[data-testid="task-stop-button"]')).toBeNull();
    openMoreMenu({ root, fixture });
    expect(root.querySelector(moreMenuItem('taskBoard.amend'))).toBeNull();
    click('[data-testid="task-resume-button"]');
    openMoreMenu({ root, fixture });
    click(moreMenuItem('taskBoard.card.backlog'));

    expect(resumed).toEqual([task.id]);
    expect(dropped).toEqual([task.id]);
  });

  it('accepts the run and closes its terminal when that action is chosen', async () => {
    const task = completedTask('验收并关闭', TERMINAL.id);
    await render([TERMINAL]);

    openMoreMenu({ root, fixture });
    const closeItem = root.querySelector<HTMLButtonElement>(
      moreMenuItem('taskBoard.card.verifyClose'),
    );
    expect(closeItem?.getAttribute('title')).toContain(TERMINAL.name);
    click(moreMenuItem('taskBoard.card.verifyClose'));

    expect(todos.task(task.id)?.stage).toBe('verified');
    expect(closedTerminalIds).toEqual([TERMINAL.id]);
  });

  it('accepts the run and leaves the terminal open when only 验证通过 is used', async () => {
    const task = completedTask('验收并保留', TERMINAL.id);
    await render([TERMINAL]);

    click(VERIFY_BUTTON);

    expect(todos.task(task.id)?.stage).toBe('verified');
    expect(closedTerminalIds).toEqual([]);
  });

  it('hides the close action when the run has no terminal left to release', async () => {
    const task = completedTask('终端已关闭', TERMINAL.id);
    await render([]);

    openMoreMenu({ root, fixture });
    expect(root.querySelector(moreMenuItem('taskBoard.card.verifyClose'))).toBeNull();
    click(VERIFY_BUTTON);

    expect(todos.task(task.id)?.stage).toBe('verified');
    expect(closedTerminalIds).toEqual([]);
  });

  it('never offers to close a terminal another task is still executing in', async () => {
    completedTask('共用终端', TERMINAL.id);
    const other = todos.createTask(WORKSPACE.id, draft(projectId, '仍在执行'))!;
    todos.beginExecution(other.id, { terminalId: TERMINAL.id });
    await render([TERMINAL]);

    expect(root.querySelector(VERIFY_BUTTON)).toBeTruthy();
    openMoreMenu({ root, fixture });
    expect(root.querySelector(moreMenuItem('taskBoard.card.verifyClose'))).toBeNull();
  });
});
