import { Workspace } from './workspace.models';
import {
  clearedNoticeStatus,
  collectGlobalTerminalNotices,
  createAttentionBanner,
  createDesktopNotification,
  globalNoticeCategory,
  globalNoticeKey,
  GlobalTerminalNotice,
  newGlobalNotices,
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

  it('parks a failed or rate-limited terminal as idle, since it is no longer working', () => {
    expect(clearedNoticeStatus('FAILED')).toBe('IDLE');
    expect(clearedNoticeStatus('RATE_LIMITED')).toBe('IDLE');
  });

  it('produces statuses that no longer raise a notice', () => {
    const cleared = (
      ['WAITING_INPUT', 'WAITING_APPROVAL', 'FAILED', 'RATE_LIMITED', 'COMPLETED'] as const
    ).map(clearedNoticeStatus);

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

  it('ranks failures after the waiting states and before completions', () => {
    const notices = collectGlobalTerminalNotices([
      workspace('one', ['COMPLETED', 'RATE_LIMITED', 'FAILED', 'WAITING_INPUT']),
    ]);

    expect(notices.map((notice) => notice.status)).toEqual([
      'WAITING_INPUT',
      'FAILED',
      'RATE_LIMITED',
      'COMPLETED',
    ]);
    expect(notices.map(globalNoticeCategory)).toEqual(['waiting', 'issue', 'issue', 'completed']);
  });

  it('never raises a notice for a terminal that is idle, starting or simply working', () => {
    expect(
      collectGlobalTerminalNotices([
        workspace('one', ['IDLE', 'STARTING', 'RUNNING', 'THINKING', 'STOPPED', 'DISCONNECTED']),
      ]),
    ).toEqual([]);
  });
});

describe('newGlobalNotices', () => {
  const keysOf = (notices: readonly GlobalTerminalNotice[]) =>
    new Set(notices.map(globalNoticeKey));

  it('announces nothing the client loaded with, however many statuses were persisted', () => {
    const loaded = collectGlobalTerminalNotices([
      workspace('one', ['WAITING_APPROVAL', 'COMPLETED', 'FAILED']),
    ]);

    expect(newGlobalNotices(loaded, null)).toEqual([]);
  });

  it('announces a notice once it appears after that, and again when a terminal re-enters it', () => {
    const working = collectGlobalTerminalNotices([workspace('one', ['COMPLETED', 'RUNNING'])]);
    const blocked = collectGlobalTerminalNotices([
      workspace('one', ['COMPLETED', 'WAITING_INPUT']),
    ]);
    const answered = collectGlobalTerminalNotices([workspace('one', ['COMPLETED', 'THINKING'])]);

    expect(newGlobalNotices(blocked, keysOf(working)).map((notice) => notice.status)).toEqual([
      'WAITING_INPUT',
    ]);
    expect(newGlobalNotices(blocked, keysOf(blocked))).toEqual([]);
    expect(newGlobalNotices(answered, keysOf(blocked))).toEqual([]);
    expect(newGlobalNotices(blocked, keysOf(answered))).toHaveLength(1);
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

  it('keeps a failed Agent on the banner, behind any that are waiting', () => {
    const failedOnly = createAttentionBanner(
      collectGlobalTerminalNotices([workspace('one', ['FAILED'])]),
    );
    expect(failedOnly).toMatchObject({
      title: '运行异常',
      detail: 'Workspace one · Terminal 1：运行异常',
      extraCount: 0,
    });

    const mixed = createAttentionBanner(
      collectGlobalTerminalNotices([workspace('one', ['RATE_LIMITED', 'WAITING_INPUT'])]),
    );
    expect(mixed).toMatchObject({ title: '2 个 Agent 等待处理', extraCount: 1 });
    expect(mixed?.target.status).toBe('WAITING_INPUT');
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

  it('creates a critical notification for a failed or rate-limited Agent', () => {
    expect(createDesktopNotification([notice('FAILED')])).toEqual({
      title: 'Termexo · 运行异常',
      body: 'Workspace one · Terminal 1',
      attention: 'critical',
    });
    expect(createDesktopNotification([notice('RATE_LIMITED')])).toEqual({
      title: 'Termexo · 触发限流',
      body: 'Workspace one · Terminal 1',
      attention: 'critical',
    });
  });

  it('labels failures with the translator when one is supplied', () => {
    const translate = (key: string) => `[${key}]`;

    expect(createDesktopNotification([notice('FAILED')], translate)?.title).toBe(
      'Termexo · [notice.agentFailed]',
    );
    expect(createDesktopNotification([notice('RATE_LIMITED')], translate)?.title).toBe(
      'Termexo · [notice.rateLimited]',
    );
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
