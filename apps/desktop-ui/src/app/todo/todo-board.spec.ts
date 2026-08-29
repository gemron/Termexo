import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

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
const CLOSE_TERMINAL_BUTTON = '[data-testid="task-verify-close-terminal"]';

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

  it('accepts the run and closes its terminal when that action is chosen', async () => {
    const task = completedTask('验收并关闭', TERMINAL.id);
    await render([TERMINAL]);

    expect(root.querySelector(CLOSE_TERMINAL_BUTTON)?.getAttribute('title')).toContain(
      TERMINAL.name,
    );
    click(CLOSE_TERMINAL_BUTTON);

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

    expect(root.querySelector(CLOSE_TERMINAL_BUTTON)).toBeNull();
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
    expect(root.querySelector(CLOSE_TERMINAL_BUTTON)).toBeNull();
  });
});
