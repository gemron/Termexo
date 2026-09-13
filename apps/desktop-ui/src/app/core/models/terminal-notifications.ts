import { TerminalStatus, Workspace } from './workspace.models';

export type GlobalTerminalNoticeStatus =
  'WAITING_INPUT' | 'WAITING_APPROVAL' | 'FAILED' | 'RATE_LIMITED' | 'COMPLETED';

/**
 * How a notice asks for the user: blocked on an answer, stopped by a problem, or simply done.
 * Only a completion leaves nothing to act on.
 */
export type GlobalNoticeCategory = 'waiting' | 'issue' | 'completed';

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

/** Blocking prompts first, then problems, then completions. */
const NOTICE_PRIORITY: Readonly<Record<GlobalTerminalNoticeStatus, number>> = {
  WAITING_APPROVAL: 0,
  WAITING_INPUT: 1,
  FAILED: 2,
  RATE_LIMITED: 3,
  COMPLETED: 4,
};

const NOTICE_CATEGORIES: Readonly<Record<GlobalTerminalNoticeStatus, GlobalNoticeCategory>> = {
  WAITING_APPROVAL: 'waiting',
  WAITING_INPUT: 'waiting',
  FAILED: 'issue',
  RATE_LIMITED: 'issue',
  COMPLETED: 'completed',
};

const NOTICE_STATUS_LABEL_KEYS: Readonly<Record<GlobalTerminalNoticeStatus, string>> = {
  WAITING_APPROVAL: 'notice.waitingApproval',
  WAITING_INPUT: 'notice.waitingInput',
  FAILED: 'notice.agentFailed',
  RATE_LIMITED: 'notice.rateLimited',
  COMPLETED: 'notice.taskCompleted',
};

/** Used when no translator is supplied. */
const NOTICE_STATUS_LABELS: Readonly<Record<GlobalTerminalNoticeStatus, string>> = {
  WAITING_APPROVAL: '等待授权',
  WAITING_INPUT: '等待输入',
  FAILED: '运行异常',
  RATE_LIMITED: '触发限流',
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
  return translate?.(NOTICE_STATUS_LABEL_KEYS[status]) ?? NOTICE_STATUS_LABELS[status];
}

const isGlobalNoticeStatus = (status: TerminalStatus): status is GlobalTerminalNoticeStatus =>
  Object.hasOwn(NOTICE_PRIORITY, status);

/** Identifies one notice occurrence; a terminal re-entering the same state produces a new one. */
export function globalNoticeKey(notice: GlobalTerminalNotice): string {
  return `${notice.terminalId}:${notice.status}`;
}

/**
 * The notices that appeared since the previous evaluation, whose keys are `previousKeys`.
 *
 * Without a previous evaluation every notice is one the client loaded with, already announced by
 * whichever window recorded that status, so a reload or a newly opened remote page announces none.
 */
export function newGlobalNotices(
  notices: readonly GlobalTerminalNotice[],
  previousKeys: ReadonlySet<string> | null,
): GlobalTerminalNotice[] {
  return previousKeys ? notices.filter((notice) => !previousKeys.has(globalNoticeKey(notice))) : [];
}

export function globalNoticeCategory(notice: GlobalTerminalNotice): GlobalNoticeCategory {
  return NOTICE_CATEGORIES[notice.status];
}

/** A notice the user still has to act on, which is every one except a completion. */
export function isAttentionNotice(notice: GlobalTerminalNotice): boolean {
  return globalNoticeCategory(notice) !== 'completed';
}

/**
 * The status a terminal falls back to once the user clears its notice.
 *
 * Clearing records that the notice has been dealt with, not that the terminal changed: one that
 * was blocking is still alive and running, while a completed, failed or rate-limited one has
 * nothing left in flight and sits at its prompt.
 */
export function clearedNoticeStatus(status: GlobalTerminalNoticeStatus): TerminalStatus {
  return NOTICE_CATEGORIES[status] === 'waiting' ? 'RUNNING' : 'IDLE';
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
 * Builds the persistent in-app banner from the notices that need the user, highest priority
 * first. The banner is what makes a blocked or failed agent visible while the window already has
 * focus, where the operating system suppresses the taskbar flash.
 */
export function createAttentionBanner(
  notices: readonly GlobalTerminalNotice[],
  translate?: NotificationTranslator,
): AttentionBanner | null {
  const waiting = notices.filter(isAttentionNotice);
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

  const requiresAttention = notices.some(isAttentionNotice);
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
