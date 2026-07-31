import { Workspace } from './workspace.models';
import { collectGlobalTerminalNotices } from './terminal-notifications';

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
