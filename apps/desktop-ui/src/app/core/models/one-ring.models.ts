export interface OneRingConnection {
  pluginDirectory: string;
  nodeCommand: string;
  stateDirectory: string;
}

export interface OneRingCoordinatorRequest {
  root: string;
  goal: string;
  workflowId?: string;
}

export interface OneRingDoctor {
  version: string;
  node: string;
  platform: string;
  stateDirectory: string;
  limits: string[];
  cli?: {
    cli: string;
    installed: boolean;
    version: string | null;
    execution: string;
    error: string | null;
  }[];
}

export interface OneRingSummary {
  id: string;
  title: string;
  root: string;
  phase: string;
  revision: number;
  updatedAt: string;
}

export interface OneRingWorkflow {
  id: string;
  root: string;
  phase: string;
  revision: number;
  plan: { title: string; goal: string; criteria: string[]; steps: string[]; version: number };
  blockedReason?: string;
  pendingStop?: boolean;
  repairRound: number;
  runs: { id: string; role: string; status: string; error?: string }[];
  verification?: {
    outcome: string;
    summary: string;
    issues: string[];
    criteria: { id: string; status: string; evidence: string }[];
    checks: { command: string; exitCode: number | null; summary: string }[];
  };
}

/** Windows paths compare without casing; POSIX paths retain their case. */
export function sameOneRingRoot(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const path = value.replaceAll('\\', '/').replace(/\/+$/, '');
    return /^[a-z]:\//i.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
  };
  return normalize(left) === normalize(right);
}

const PHASES: Record<string, string> = {
  AWAITING_PLAN_APPROVAL: '等待计划确认',
  BUILDING: '实施中',
  VERIFYING: '独立验证中',
  AWAITING_REPAIR_APPROVAL: '等待修复确认',
  AWAITING_DELIVERY_APPROVAL: '等待交付确认',
  BLOCKED: '已阻塞',
  COMPLETED: '已确认交付',
  CANCELLED: '已取消',
  FAILED: '已失败',
};
export function oneRingPhaseLabel(phase: string): string {
  return PHASES[phase] ?? phase;
}
