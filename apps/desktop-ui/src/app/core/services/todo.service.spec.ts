import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentEvent } from '../models/agent.models';
import type { TodoTaskDraft } from '../models/todo.models';
import { compatibleTodoSessionId, todoWorkingDirectory } from '../models/todo.models';
import type { Workspace } from '../models/workspace.models';
import { TodoService } from './todo.service';

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Termexo',
  projectPath: 'D:/devlop/Termexo',
  projectType: 'Local project',
  activeBranch: 'main',
  favorite: false,
  lastOpenedAt: 1,
  layout: 'single',
  terminals: [],
};

function draft(
  projectId: string,
  workingDirectory = '',
  preferredTerminalId?: string,
): TodoTaskDraft {
  return {
    projectId,
    title: '实现任务看板',
    description: '支持拖拽和真实 Agent 执行',
    acceptanceCriteria: '单元测试和浏览器验证通过',
    priority: 'high',
    workingDirectory,
    agentType: 'codex',
    profileId: 'codex-default',
    modelName: 'gpt-5.6-sol',
    preferredTerminalId,
  };
}

describe('TodoService', () => {
  beforeEach(() => window.localStorage.clear());

  it('creates a default project, supports multiple projects, and persists tasks', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const defaultProject = service.projectsFor(workspace.id)[0];
    const secondProject = service.createProject(workspace.id, {
      name: 'Website',
      path: 'D:/devlop/Termexo/website',
    });
    const task = service.createTask(workspace.id, draft(secondProject!.id));

    expect(defaultProject).toMatchObject({ name: 'Termexo', path: workspace.projectPath });
    expect(secondProject).toMatchObject({ name: 'Website', workspaceId: workspace.id });
    expect(task).toMatchObject({
      stage: 'todo',
      projectId: secondProject!.id,
      attempts: 0,
      promptDeliveryState: 'idle',
    });

    const restored = new TodoService();
    restored.initialize([workspace]);
    expect(restored.projectsFor(workspace.id)).toHaveLength(2);
    expect(restored.tasksFor(workspace.id)[0].title).toBe('实现任务看板');
  });

  it('only removes a project once it is empty and another one remains', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const defaultProject = service.projectsFor(workspace.id)[0];
    const extra = service.createProject(workspace.id, { name: '桌面端', path: 'D:/devlop/ui' })!;
    const task = service.createTask(workspace.id, draft(extra.id))!;

    expect(service.canDeleteProject(extra.id)).toBe(false);
    expect(service.deleteProject(extra.id)).toBe(false);

    service.deleteTask(task.id);
    expect(service.canDeleteProject(extra.id)).toBe(true);
    expect(service.deleteProject(extra.id)).toBe(true);
    expect(service.projectsFor(workspace.id)).toHaveLength(1);

    // The board always needs somewhere to run a task, so the last project stays.
    expect(service.canDeleteProject(defaultProject.id)).toBe(false);
    expect(service.deleteProject(defaultProject.id)).toBe(false);

    const restored = new TodoService();
    restored.initialize([workspace]);
    expect(restored.projectsFor(workspace.id).map((item) => item.id)).toEqual([defaultProject.id]);
  });

  it('runs a task in its own directory and follows the project when none is chosen', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const project = service.projectsFor(workspace.id)[0];
    const inherited = service.createTask(workspace.id, draft(project.id))!;
    const overridden = service.createTask(
      workspace.id,
      draft(project.id, 'D:/devlop/Termexo/apps/desktop-ui'),
    )!;

    expect(todoWorkingDirectory(inherited, project)).toBe(workspace.projectPath);
    expect(todoWorkingDirectory(overridden, project)).toBe('D:/devlop/Termexo/apps/desktop-ui');

    const moved = service.updateProject(project.id, { name: '桌面端', path: 'D:/devlop/Other' })!;

    expect(moved).toMatchObject({ id: project.id, name: '桌面端', path: 'D:/devlop/Other' });
    expect(todoWorkingDirectory(service.task(inherited.id)!, moved)).toBe('D:/devlop/Other');
    expect(todoWorkingDirectory(service.task(overridden.id)!, moved)).toBe(
      'D:/devlop/Termexo/apps/desktop-ui',
    );
    expect(service.updateProject(project.id, { name: '桌面端', path: '  ' })).toBeNull();
  });

  it('tracks a terminal execution and automatically moves a completed agent turn', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const task = service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id))!;
    service.beginExecution(task.id, { terminalId: 'terminal-1' });
    expect(service.task(task.id)?.promptDeliveryState).toBe('pending');
    service.markPromptSending(task.id, 'terminal-1');
    expect(service.task(task.id)?.promptDeliveryState).toBe('sending');
    service.markPromptDelivered(task.id, 'terminal-1');
    service.handleTerminalStatus('terminal-1', 'RUNNING');
    service.captureTerminalOutput('terminal-1', '\u001b[32mTests passed\u001b[0m\r\n');

    const event: AgentEvent = {
      eventKey: 'event-1',
      agentType: 'codex',
      nativeSessionId: 'thread-1',
      terminalId: 'terminal-1',
      eventType: 'task.completed',
      detail: {},
      createdAt: Date.now(),
    };
    service.applyAgentEvent(event);

    expect(service.task(task.id)).toMatchObject({
      stage: 'completed',
      executionState: 'completed',
      nativeSessionId: 'thread-1',
      attempts: 1,
      promptDeliveryState: 'delivered',
    });
    expect(service.task(task.id)?.outputTail).toContain('Tests passed');
    expect(service.task(task.id)?.outputTail).not.toContain('\u001b');

    service.handleTerminalStatus('terminal-1', 'STOPPED');
    expect(service.task(task.id)?.executionState).toBe('completed');
    service.handleTerminalStatus('terminal-1', 'RUNNING');
    expect(service.task(task.id)).toMatchObject({
      stage: 'completed',
      executionState: 'completed',
      lastTerminalStatus: 'COMPLETED',
    });
  });

  it('returns a stopped task to 待办 and stops it from tracking the terminal it left', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const task = service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id))!;
    service.beginExecution(task.id, { terminalId: 'terminal-1', nativeSessionId: 'thread-1' });
    service.markPromptDelivered(task.id, 'terminal-1');
    service.captureTerminalOutput('terminal-1', 'half of the work\r\n');

    expect(service.stopExecution(task.id)).toMatchObject({
      stage: 'todo',
      executionState: 'idle',
      promptDeliveryState: 'idle',
      terminalId: undefined,
      outputTail: undefined,
      startedAt: undefined,
      nativeSessionId: 'thread-1',
      attempts: 1,
    });

    // The terminal keeps running until the shell interrupts it; none of it belongs to the task now.
    service.handleTerminalStatus('terminal-1', 'COMPLETED');
    service.captureTerminalOutput('terminal-1', 'work that is no longer the task\r\n');
    expect(service.task(task.id)).toMatchObject({ stage: 'todo', outputTail: undefined });

    // Only a running task can be stopped, and the next attempt resumes the session it kept.
    expect(service.stopExecution(task.id)).toBeNull();
    expect(service.beginExecution(task.id, { terminalId: 'terminal-2' }, true)).toMatchObject({
      stage: 'executing',
      attempts: 2,
    });
  });

  it('guards prompt delivery updates against a stale terminal attempt', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const task = service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id))!;
    service.beginExecution(task.id, { terminalId: 'terminal-new' });

    expect(service.markPromptSending(task.id, 'terminal-old')).toBeNull();
    service.setExecutionError(task.id, 'old terminal failed', 'terminal-old');
    expect(service.task(task.id)).toMatchObject({
      terminalId: 'terminal-new',
      promptDeliveryState: 'pending',
      lastError: undefined,
    });

    service.markPromptSending(task.id, 'terminal-new');
    service.setExecutionError(task.id, 'write failed', 'terminal-new');
    expect(service.task(task.id)).toMatchObject({
      executionState: 'failed',
      promptDeliveryState: 'failed',
      lastError: 'write failed',
    });
  });

  it('reconciles restored terminal bindings and fails tasks whose terminal disappeared', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const task = service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id))!;
    service.beginExecution(task.id, { terminalId: 'terminal-1', nativeSessionId: 'thread-1' });
    // A task that was genuinely running when the app closed had already handed over its prompt.
    service.markPromptDelivered(task.id, 'terminal-1');

    service.reconcileTerminals([
      {
        ...workspace,
        terminals: [
          {
            id: 'terminal-1',
            name: 'Task terminal',
            workingDirectory: workspace.projectPath,
            shell: 'powershell',
            agentType: 'codex',
            status: 'STARTING',
            model: 'gpt-5.6-sol',
            branch: 'main',
          },
        ],
      },
    ]);
    expect(service.task(task.id)).toMatchObject({
      executionState: 'starting',
      lastTerminalStatus: 'STARTING',
      lastError: undefined,
    });

    service.reconcileTerminals([workspace]);
    expect(service.task(task.id)).toMatchObject({
      stage: 'executing',
      executionState: 'failed',
      lastTerminalStatus: 'DISCONNECTED',
      lastError: '关联终端不存在或已关闭，可重试以恢复原会话。',
    });

    service.beginExecution(
      task.id,
      { terminalId: 'terminal-2', nativeSessionId: 'thread-1' },
      true,
    );
    service.handleTerminalStatus('terminal-2', 'STOPPED');
    expect(service.task(task.id)).toMatchObject({
      executionState: 'failed',
      lastTerminalStatus: 'STOPPED',
      lastError: 'Agent 终端已结束，请检查终端输出后重试。',
    });
  });

  it('recovers a task whose prompt was still in flight when the app was restarted', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const task = service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id))!;
    service.beginExecution(task.id, { terminalId: 'terminal-1' });
    service.markPromptSending(task.id, 'terminal-1');

    // The armed prompt lives only in memory, so a restart leaves nothing to finish the delivery.
    const restarted = new TodoService();
    restarted.initialize([workspace]);
    restarted.reconcileTerminals([
      {
        ...workspace,
        terminals: [
          {
            id: 'terminal-1',
            name: 'Task terminal',
            workingDirectory: workspace.projectPath,
            shell: 'powershell',
            agentType: 'codex',
            status: 'IDLE',
            model: 'gpt-5.6-sol',
            branch: 'main',
          },
        ],
      },
    ]);

    expect(restarted.task(task.id)).toMatchObject({
      stage: 'executing',
      executionState: 'failed',
      promptDeliveryState: 'failed',
      lastError: '任务指令未送达终端，请重新发送。',
    });
  });

  it('persists an existing-terminal preference and routes reused terminal output to the active task', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const projectId = service.projectsFor(workspace.id)[0].id;
    const first = service.createTask(workspace.id, draft(projectId))!;
    const second = service.createTask(workspace.id, draft(projectId, '', 'terminal-1'))!;

    service.beginExecution(first.id, { terminalId: 'terminal-1' });
    service.markCompleted(first.id);
    service.beginExecution(second.id, { terminalId: 'terminal-1' });
    service.captureTerminalOutput('terminal-1', 'second task output');

    expect(service.task(second.id)).toMatchObject({
      preferredTerminalId: 'terminal-1',
      terminalId: 'terminal-1',
      stage: 'executing',
      outputTail: 'second task output',
    });
    expect(service.task(first.id)?.outputTail).toBeUndefined();

    const restored = new TodoService();
    restored.initialize([workspace]);
    expect(restored.task(second.id)?.preferredTerminalId).toBe('terminal-1');
  });

  it('records failed validation and reuses the bound session for another attempt', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const task = service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id))!;
    service.beginExecution(task.id, { terminalId: 'terminal-1', nativeSessionId: 'thread-1' });
    service.markCompleted(task.id);

    const rejected = service.rejectValidation({
      taskId: task.id,
      feedback: '边界条件仍然失败',
      description: '补齐边界条件',
      acceptanceCriteria: '新增回归测试',
    });
    service.beginExecution(
      task.id,
      { terminalId: 'terminal-1', nativeSessionId: 'thread-1' },
      true,
    );

    expect(rejected).toMatchObject({ stage: 'executing', description: '补齐边界条件' });
    expect(service.task(task.id)).toMatchObject({
      terminalId: 'terminal-1',
      nativeSessionId: 'thread-1',
      stage: 'executing',
      attempts: 2,
    });
    expect(service.task(task.id)?.validations.at(-1)).toMatchObject({
      outcome: 'failed',
      note: '边界条件仍然失败',
    });
  });

  it('clears a native session binding when a task switches Agent type', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const projectId = service.projectsFor(workspace.id)[0].id;
    const task = service.createTask(workspace.id, draft(projectId))!;
    service.beginExecution(task.id, {
      terminalId: 'terminal-codex',
      nativeSessionId: 'codex-session',
      accountProfileId: 'codex-work',
    });
    expect(service.task(task.id)).toMatchObject({
      nativeSessionAgentType: 'codex',
      accountProfileId: 'codex-work',
    });

    const updated = service.updateTask(task.id, {
      ...draft(projectId),
      agentType: 'claude',
      profileId: 'claude-default',
      modelName: 'Claude Sonnet',
    });

    expect(updated).toMatchObject({ agentType: 'claude' });
    expect(updated?.terminalId).toBeUndefined();
    expect(updated?.nativeSessionId).toBeUndefined();
    expect(updated?.nativeSessionAgentType).toBeUndefined();
    expect(updated?.accountProfileId).toBeUndefined();
  });

  it('ignores hook events emitted by a different Agent for a bound task terminal', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const task = service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id))!;
    service.beginExecution(task.id, { terminalId: 'terminal-1' });

    service.applyAgentEvent({
      eventKey: 'event-claude',
      agentType: 'claude',
      nativeSessionId: 'claude-session',
      terminalId: 'terminal-1',
      eventType: 'task.completed',
      detail: {},
      createdAt: Date.now(),
    });

    expect(service.task(task.id)).toMatchObject({
      agentType: 'codex',
      stage: 'executing',
    });
    expect(service.task(task.id)?.nativeSessionId).toBeUndefined();
  });

  it('rejects a legacy session ID known to belong to the other Agent', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const task = service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id))!;
    const legacyTask = { ...task, nativeSessionId: 'claude-session', attempts: 1 };

    expect(
      compatibleTodoSessionId(
        legacyTask,
        [],
        [{ agentType: 'claude', nativeSessionId: 'claude-session' }],
      ),
    ).toBeUndefined();
    expect(
      compatibleTodoSessionId(
        { ...legacyTask, nativeSessionId: 'codex-session' },
        [{ agentType: 'codex', nativeSessionId: 'codex-session' }],
        [],
      ),
    ).toBe('codex-session');
    expect(compatibleTodoSessionId(legacyTask, [], [])).toBeUndefined();
  });

  it('requires completion before verification and records a passing validation', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const task = service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id))!;

    expect(service.verifyTask(task.id)).toBeNull();
    service.markCompleted(task.id);
    service.verifyTask(task.id, '人工回归通过');

    expect(service.task(task.id)).toMatchObject({ stage: 'verified' });
    expect(service.task(task.id)?.validations).toEqual([
      expect.objectContaining({ outcome: 'passed', note: '人工回归通过' }),
    ]);
  });

  it('runs a 常用任务 again from a clean run and keeps its history', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const projectId = service.projectsFor(workspace.id)[0].id;
    const task = service.createTask(workspace.id, { ...draft(projectId), recurring: true })!;

    service.beginExecution(task.id, { terminalId: 'terminal-build', nativeSessionId: 'session-1' });
    service.captureTerminalOutput('terminal-build', '编译完成');
    service.markCompleted(task.id);
    service.verifyTask(task.id, '构建产物已确认');
    const restarted = service.restartTask(task.id);

    expect(restarted).toMatchObject({
      stage: 'todo',
      executionState: 'idle',
      promptDeliveryState: 'idle',
      terminalId: undefined,
      nativeSessionId: undefined,
      outputTail: undefined,
      attempts: 0,
      runCount: 1,
      recurring: true,
    });
    expect(restarted?.lastRunAt).toBeGreaterThan(0);
    expect(restarted?.validations).toHaveLength(1);

    // A second run archives on top of the first one instead of restarting the count.
    service.beginExecution(task.id, { terminalId: 'terminal-build-2' });
    service.markCompleted(task.id);
    expect(service.restartTask(task.id)?.runCount).toBe(2);
  });

  it('only repeats tasks marked 常用 and only once their run is over', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const projectId = service.projectsFor(workspace.id)[0].id;
    const plain = service.createTask(workspace.id, draft(projectId))!;
    const routine = service.createTask(workspace.id, { ...draft(projectId), recurring: true })!;

    service.markCompleted(plain.id);
    expect(service.restartTask(plain.id)).toBeNull();

    // A 常用任务 that has not finished its current run stays where it is.
    service.beginExecution(routine.id, { terminalId: 'terminal-release' });
    expect(service.restartTask(routine.id)).toBeNull();
    expect(service.task(routine.id)).toMatchObject({ stage: 'executing' });
  });

  it('keeps tasks stored before 常用任务 existed out of the repeatable set', () => {
    const service = new TodoService();
    service.initialize([workspace]);
    const stored = JSON.parse(window.localStorage.getItem('termexo.todos.v1')!);
    stored[workspace.id].tasks = [
      {
        id: 'legacy-task',
        workspaceId: workspace.id,
        projectId: service.projectsFor(workspace.id)[0].id,
        title: '旧版本任务',
        description: '',
        acceptanceCriteria: '',
        priority: 'medium',
        stage: 'verified',
        sortOrder: 0,
        agentType: 'claude',
        profileId: 'claude-default',
        modelName: 'opus',
        executionState: 'completed',
        attempts: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    window.localStorage.setItem('termexo.todos.v1', JSON.stringify(stored));

    const restored = new TodoService();
    restored.initialize([workspace]);

    expect(restored.task('legacy-task')).toMatchObject({ recurring: false, runCount: 0 });
    expect(restored.restartTask('legacy-task')).toBeNull();
  });

  it('preserves projects and tasks when workspaces are merged', () => {
    const target: Workspace = { ...workspace, id: 'workspace-2', name: 'Target' };
    const service = new TodoService();
    service.initialize([workspace, target]);
    service.createTask(workspace.id, draft(service.projectsFor(workspace.id)[0].id));

    service.mergeWorkspaces(workspace.id, target);

    expect(service.snapshot(workspace.id)).toBeNull();
    expect(service.projectsFor(target.id)).toHaveLength(2);
    expect(service.tasksFor(target.id)).toEqual([
      expect.objectContaining({ workspaceId: target.id, title: '实现任务看板' }),
    ]);
  });
});
