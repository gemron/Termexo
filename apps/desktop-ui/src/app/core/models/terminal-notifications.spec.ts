import { Workspace } from './workspace.models';
import {
  clearedNoticeStatus,
  collectGlobalTerminalNotices,
  createAttentionBanner,
  createDesktopNotification,
  GlobalTerminalNotice,
} from './terminal-notifications';

const workspace = (
  id: string,
  statuses: Workspace['terminals'][number]['status'][],
): Workspace => ({
  id,
  name: `Workspace ${id}`,
  projectPath: `D:\\dev\\${id}`,
  projectType: 'Local project',
  activeBranch: 'main',
  favorite: false,
  lastOpenedAt: 1,
  layout: 'grid',
  terminals: statuses.map((status, index) => ({
    id: `${id}-terminal-${index}`,
    name: `Terminal ${index + 1}`,
    workingDirectory: `D:\\dev\\${id}`,
    shell: 'powershell.exe',
    agentType: 'claude',
    status,
    model: 'Claude Sonnet',
    branch: 'main',
  })),
});

describe('clearedNoticeStatus', () => {
  it('leaves a blocked terminal running, since clearing only acknowledges the notice', () => {
    expect(clearedNoticeStatus('WAITING_INPUT')).toBe('RUNNING');
    expect(clearedNoticeStatus('WAITING_APPROVAL')).toBe('RUNNING');
  });

  it('parks a finished terminal as idle, because it has nothing left in flight', () => {
    expect(clearedNoticeStatus('COMPLETED')).toBe('IDLE');
  });

  it('produces statuses that no longer raise a notice', () => {
    const cleared = (['WAITING_INPUT', 'WAITING_APPROVAL', 'COMPLETED'] as const).map(
      clearedNoticeStatus,
    );

    expect(collectGlobalTerminalNotices([workspace('one', cleared)])).toEqual([]);
  });
});

describe('collectGlobalTerminalNotices', () => {
  it('collects waiting and completed terminals across every workspace', () => {
    const notices = collectGlobalTerminalNotices([
      workspace('one', ['RUNNING', 'COMPLETED']),
      workspace('two', ['WAITING_INPUT', 'WAITING_APPROVAL']),
    ]);

    expect(notices.map((notice) => notice.status)).toEqual([
      'WAITING_APPROVAL',
      'WAITING_INPUT',
      'COMPLETED',
    ]);
    expect(new Set(notices.map((notice) => notice.workspaceId))).toEqual(new Set(['one', 'two']));
  });
});

describe('createAttentionBanner', () => {
  it('keeps a completed Agent out of the persistent banner', () => {
    expect(
      createAttentionBanner(collectGlobalTerminalNotices([workspace('one', ['COMPLETED'])])),
    ).toBeNull();
  });

  it('reports nothing when no terminal is waiting', () => {
    expect(createAttentionBanner([])).toBeNull();
  });

  it('targets the single waiting terminal', () => {
    const banner = createAttentionBanner(
      collectGlobalTerminalNotices([workspace('one', ['RUNNING', 'WAITING_INPUT'])]),
    );

    expect(banner).toMatchObject({
      title: '等待输入',
      detail: 'Workspace one · Terminal 2：等待输入',
      extraCount: 0,
    });
    expect(banner?.target.terminalId).toBe('one-terminal-1');
  });

  it('counts every waiting terminal and targets approval before input', () => {
    const banner = createAttentionBanner(
      collectGlobalTerminalNotices([
        workspace('one', ['WAITING_INPUT', 'COMPLETED']),
        workspace('two', ['WAITING_APPROVAL']),
      ]),
    );

    expect(banner).toMatchObject({
      title: '2 个 Agent 等待处理',
      detail: 'Workspace two · Terminal 1：等待授权',
      extraCount: 1,
    });
    expect(banner?.target.status).toBe('WAITING_APPROVAL');
  });
});

describe('createDesktopNotification', () => {
  const notice = (
    status: GlobalTerminalNotice['status'],
    terminalName = 'Terminal 1',
  ): GlobalTerminalNotice => ({
    workspaceId: 'workspace-one',
    workspaceName: 'Workspace one',
    terminalId: `terminal-${terminalName}`,
    terminalName,
    status,
  });

  it('creates a critical notification for an Agent waiting for approval', () => {
    expect(createDesktopNotification([notice('WAITING_APPROVAL')])).toEqual({
      title: 'Termexo · 等待授权',
      body: 'Workspace one · Terminal 1',
      attention: 'critical',
    });
  });

  it('creates a critical notification for an Agent waiting for input', () => {
    expect(createDesktopNotification([notice('WAITING_INPUT')])).toEqual({
      title: 'Termexo · 等待输入',
      body: 'Workspace one · Terminal 1',
      attention: 'critical',
    });
  });

  it('creates an informational notification for a completed Agent', () => {
    expect(createDesktopNotification([notice('COMPLETED')])).toEqual({
      title: 'Termexo · 任务已完成',
      body: 'Workspace one · Terminal 1',
      attention: 'informational',
    });
  });

  it('summarizes a batch and prioritizes waiting states', () => {
    const notification = createDesktopNotification([
      notice('COMPLETED', 'Terminal 1'),
      notice('WAITING_INPUT', 'Terminal 2'),
      notice('COMPLETED', 'Terminal 3'),
      notice('COMPLETED', 'Terminal 4'),
    ]);

    expect(notification).toEqual({
      title: 'Termexo · 4 个 Agent 等待处理',
      body: 'Workspace one · Terminal 1：任务已完成；Workspace one · Terminal 2：等待输入；Workspace one · Terminal 3：任务已完成；另有 1 个状态',
      attention: 'critical',
    });
  });

  it('does not create a notification for an empty batch', () => {
    expect(createDesktopNotification([])).toBeNull();
  });
});
