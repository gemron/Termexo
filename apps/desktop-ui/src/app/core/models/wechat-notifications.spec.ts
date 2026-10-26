import { describe, expect, it } from 'vitest';
import { WechatEventTracker, DEFAULT_WECHAT_SETTINGS } from './wechat-notifications';
import type { Workspace } from './workspace.models';
import type { AgentEvent } from './agent.models';
import type { TodoWorkspaceSnapshot } from './todo.models';

function workspace(status = 'RUNNING', agentType = 'codex'): Workspace {
  return {
    id: 'w',
    name: 'Project',
    projectPath: 'D:/test',
    projectType: '',
    activeBranch: '',
    favorite: false,
    lastOpenedAt: 0,
    layout: 'single',
    terminals: [
      {
        id: 'agent',
        name: 'Agent',
        agentType: agentType as 'codex' | 'shell',
        workingDirectory: 'D:/test',
        shell: 'powershell',
        status: status as 'RUNNING',
        model: '',
        branch: '',
      },
    ],
  };
}
const event = (eventKey: string, eventType: string, createdAt = 101, detail = {}): AgentEvent => ({
  eventKey,
  eventType,
  terminalId: 'agent',
  agentType: 'codex',
  createdAt,
  detail,
});

describe('WeChat event occurrence tracking', () => {
  it('does not send a completion notification for a manual idle correction', () => {
    const tracker = new WechatEventTracker(100);
    tracker.collect([workspace('RUNNING')], {}, []);
    expect(tracker.collect([workspace('IDLE')], {}, [])).toEqual([]);
    expect(tracker.collect([workspace('THINKING')], {}, [])).toEqual([]);
    expect(tracker.collect([workspace('COMPLETED')], {}, [])).toMatchObject([{ kind: 'completed' }]);
  });
  it('is disabled by default and does not notify restored state or old event history', () => {
    expect(DEFAULT_WECHAT_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_WECHAT_SETTINGS.target).toBe('文件传输助手');
    const tracker = new WechatEventTracker(100);
    expect(
      tracker.collect([workspace('COMPLETED')], {}, [event('old', 'task.completed', 50)]),
    ).toEqual([]);
    expect(
      tracker.collect([workspace('COMPLETED')], {}, [
        event('old', 'task.completed', 50),
        event('older', 'agent.failed', 60),
      ]),
    ).toEqual([]);
  });
  it('notifies each later error or approval once even if status remains unchanged', () => {
    const tracker = new WechatEventTracker(100);
    tracker.collect([workspace()], {}, []);
    const first = event('e1', 'approval.required', 101, { request_id: 'p1' });
    expect(tracker.collect([workspace('WAITING_APPROVAL')], {}, [first])).toMatchObject([
      { kind: 'approval', eventKey: 'approval:agent:p1' },
    ]);
    expect(tracker.collect([workspace('WAITING_APPROVAL')], {}, [first])).toEqual([]);
    expect(
      tracker.collect([workspace('WAITING_APPROVAL')], {}, [
        first,
        event('e2', 'approval.required', 102, { request_id: 'p2' }),
      ]),
    ).toHaveLength(1);
    expect(
      tracker.collect([workspace('FAILED')], {}, [event('e3', 'agent.failed', 103)]),
    ).toMatchObject([{ kind: 'error' }]);
    expect(
      tracker.collect([workspace('FAILED')], {}, [event('e4', 'agent.failed', 104)]),
    ).toHaveLength(1);
  });
  it('reports UI-detected transitions, but avoids duplicate hook and status notices', () => {
    const tracker = new WechatEventTracker(100);
    tracker.collect([workspace()], {}, []);
    expect(tracker.collect([workspace('WAITING_INPUT')], {}, [])).toMatchObject([
      { kind: 'input' },
    ]);
    expect(tracker.collect([workspace('WAITING_INPUT')], {}, [])).toEqual([]);
    tracker.collect([workspace()], {}, []);
    expect(
      tracker.collect([workspace('COMPLETED')], {}, [event('done', 'task.completed')]),
    ).toHaveLength(1);
  });
  it('never notifies ordinary shells, common operations, login terminals or startup idle', () => {
    const tracker = new WechatEventTracker(100);
    tracker.collect([workspace()], {}, []);
    expect(
      tracker.collect([workspace('FAILED', 'shell')], {}, [event('e1', 'agent.failed')]),
    ).toEqual([]);
    const common = workspace('FAILED');
    common.terminals[0].commonActionId = 'server';
    expect(tracker.collect([common], {}, [event('e2', 'agent.failed')])).toEqual([]);
    const login = workspace('WAITING_APPROVAL');
    login.terminals[0].accountLogin = true;
    expect(tracker.collect([login], {}, [event('e3', 'approval.required')])).toEqual([]);
    expect(tracker.collect([workspace('IDLE')], {}, [event('e4', 'session.ready')])).toEqual([]);
  });
  it('coalesces hook and status signals that arrive in separate observations', () => {
    const hookFirst = new WechatEventTracker(100);
    hookFirst.collect([workspace()], {}, []);
    const done = event('done', 'task.completed');
    expect(hookFirst.collect([workspace()], {}, [done])).toHaveLength(1);
    expect(hookFirst.collect([workspace('COMPLETED')], {}, [done])).toEqual([]);
    const stateFirst = new WechatEventTracker(100);
    stateFirst.collect([workspace()], {}, []);
    expect(stateFirst.collect([workspace('FAILED')], {}, [])).toHaveLength(1);
    const error = event('error', 'agent.failed');
    expect(stateFirst.collect([workspace('FAILED')], {}, [error])).toEqual([]);
    expect(
      stateFirst.collect([workspace('FAILED')], {}, [error, event('next', 'agent.failed', 102)]),
    ).toHaveLength(1);
  });
  it('reports task launch failures without a terminal and new failure details', () => {
    const tracker = new WechatEventTracker(100);
    const task = {
      id: 't',
      workspaceId: 'w',
      title: 'Build',
      attempts: 1,
      runCount: 0,
      stage: 'executing',
      executionState: 'starting',
      updatedAt: 101,
      projectId: 'p',
      description: '',
      acceptanceCriteria: '',
      priority: 'medium',
      sortOrder: 0,
      agentType: 'codex',
      profileId: '',
      modelName: '',
      promptDeliveryState: 'delivered',
      recurring: false,
      validations: [],
      createdAt: 100,
    };
    const snapshots = {
      w: { version: 1, workspaceId: 'w', projects: [], tasks: [task] },
    } as unknown as Record<string, TodoWorkspaceSnapshot>;
    tracker.collect([workspace()], snapshots, []);
    snapshots['w'].tasks[0] = {
      ...snapshots['w'].tasks[0],
      executionState: 'failed',
      lastError: 'CLI missing',
      updatedAt: 102,
    };
    expect(tracker.collect([workspace()], snapshots, [])).toMatchObject([
      { kind: 'error', taskTitle: 'Build' },
    ]);
    expect(tracker.collect([workspace()], snapshots, [])).toEqual([]);
    snapshots['w'].tasks[0] = {
      ...snapshots['w'].tasks[0],
      lastError: 'Network error',
      updatedAt: 103,
    };
    expect(tracker.collect([workspace()], snapshots, [])).toHaveLength(1);
  });
});
