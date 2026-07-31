import { TerminalStatus, Workspace } from './workspace.models';

export type GlobalTerminalNoticeStatus = 'WAITING_INPUT' | 'WAITING_APPROVAL' | 'COMPLETED';

export interface GlobalTerminalNotice {
  workspaceId: string;
  workspaceName: string;
  terminalId: string;
  terminalName: string;
  status: GlobalTerminalNoticeStatus;
}

const NOTICE_PRIORITY: Readonly<Record<GlobalTerminalNoticeStatus, number>> = {
  WAITING_APPROVAL: 0,
  WAITING_INPUT: 1,
  COMPLETED: 2,
};

const isGlobalNoticeStatus = (status: TerminalStatus): status is GlobalTerminalNoticeStatus =>
  status === 'WAITING_INPUT' || status === 'WAITING_APPROVAL' || status === 'COMPLETED';

export function collectGlobalTerminalNotices(
  workspaces: readonly Workspace[],
): GlobalTerminalNotice[] {
  return workspaces
    .flatMap((workspace) =>
      workspace.terminals.flatMap((terminal) =>
        isGlobalNoticeStatus(terminal.status)
          ? [
              {
                workspaceId: workspace.id,
                workspaceName: workspace.name,
                terminalId: terminal.id,
                terminalName: terminal.name,
                status: terminal.status,
              },
            ]
          : [],
      ),
    )
    .sort((left, right) => NOTICE_PRIORITY[left.status] - NOTICE_PRIORITY[right.status]);
}
