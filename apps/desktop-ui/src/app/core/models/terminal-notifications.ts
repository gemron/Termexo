import { TerminalStatus, Workspace } from './workspace.models';

export type GlobalTerminalNoticeStatus = 'WAITING_INPUT' | 'WAITING_APPROVAL' | 'COMPLETED';

export interface GlobalTerminalNotice {
  workspaceId: string;
  workspaceName: string;
  terminalId: string;
  terminalName: string;
  status: GlobalTerminalNoticeStatus;
}

export type DesktopAttentionLevel = 'critical' | 'informational';

export interface DesktopNotificationPayload {
  title: string;
  body: string;
  attention: DesktopAttentionLevel;
}

/**
 * A terminal that blocks on the user. Unlike a completed task it stays actionable until the
 * agent moves on, so the workbench keeps a persistent banner instead of a transient toast.
 */
export interface AttentionBanner {
  title: string;
  detail: string;
  target: GlobalTerminalNotice;
  extraCount: number;
}

const NOTICE_PRIORITY: Readonly<Record<GlobalTerminalNoticeStatus, number>> = {
  WAITING_APPROVAL: 0,
  WAITING_INPUT: 1,
  COMPLETED: 2,
};

const NOTICE_STATUS_LABELS: Readonly<Record<GlobalTerminalNoticeStatus, string>> = {
  WAITING_APPROVAL: '等待授权',
  WAITING_INPUT: '等待输入',
  COMPLETED: '任务已完成',
};

export type NotificationTranslator = (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string;

function noticeStatusLabel(
  status: GlobalTerminalNoticeStatus,
  translate?: NotificationTranslator,
): string {
  const keys: Readonly<Record<GlobalTerminalNoticeStatus, string>> = {
    WAITING_APPROVAL: 'notice.waitingApproval',
    WAITING_INPUT: 'notice.waitingInput',
    COMPLETED: 'notice.taskCompleted',
  };
  return translate?.(keys[status]) ?? NOTICE_STATUS_LABELS[status];
}

const isGlobalNoticeStatus = (status: TerminalStatus): status is GlobalTerminalNoticeStatus =>
  status === 'WAITING_INPUT' || status === 'WAITING_APPROVAL' || status === 'COMPLETED';

/** Identifies one notice occurrence; a terminal re-entering the same state produces a new one. */
export function globalNoticeKey(notice: GlobalTerminalNotice): string {
  return `${notice.terminalId}:${notice.status}`;
}

export function isWaitingNotice(notice: GlobalTerminalNotice): boolean {
  return notice.status !== 'COMPLETED';
}

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

/**
 * Builds the persistent in-app banner from the waiting notices, highest priority first. The
 * banner is what makes a blocked agent visible while the window already has focus, where the
 * operating system suppresses the taskbar flash.
 */
export function createAttentionBanner(
  notices: readonly GlobalTerminalNotice[],
  translate?: NotificationTranslator,
): AttentionBanner | null {
  const waiting = notices.filter(isWaitingNotice);
  const target = waiting[0];
  if (!target) {
    return null;
  }

  const statusLabel = noticeStatusLabel(target.status, translate);
  return {
    title:
      waiting.length > 1
        ? (translate?.('notice.agentsWaiting', { count: waiting.length }) ??
          `${waiting.length} 个 Agent 等待处理`)
        : statusLabel,
    detail: `${target.workspaceName} · ${target.terminalName}${translate ? ': ' : '：'}${statusLabel}`,
    target,
    extraCount: waiting.length - 1,
  };
}

export function createDesktopNotification(
  notices: readonly GlobalTerminalNotice[],
  translate?: NotificationTranslator,
): DesktopNotificationPayload | null {
  if (notices.length === 0) {
    return null;
  }

  const requiresAttention = notices.some((notice) => notice.status !== 'COMPLETED');
  if (notices.length === 1) {
    const notice = notices[0];
    return {
      title: `Termexo · ${noticeStatusLabel(notice.status, translate)}`,
      body: `${notice.workspaceName} · ${notice.terminalName}`,
      attention: requiresAttention ? 'critical' : 'informational',
    };
  }

  const details = notices
    .slice(0, 3)
    .map(
      (notice) =>
        `${notice.workspaceName} · ${notice.terminalName}${translate ? ': ' : '：'}${noticeStatusLabel(notice.status, translate)}`,
    );
  const remaining = notices.length - details.length;
  if (remaining > 0) {
    details.push(
      translate?.('notice.otherStatuses', { count: remaining }) ?? `另有 ${remaining} 个状态`,
    );
  }

  return {
    title: requiresAttention
      ? `Termexo · ${translate?.('notice.agentsWaiting', { count: notices.length }) ?? `${notices.length} 个 Agent 等待处理`}`
      : `Termexo · ${translate?.('notice.agentsCompleted', { count: notices.length }) ?? `${notices.length} 个 Agent 已完成`}`,
    body: details.join(translate ? '; ' : '；'),
    attention: requiresAttention ? 'critical' : 'informational',
  };
}
