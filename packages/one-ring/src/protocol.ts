import { z } from 'zod';

export const profileSchema = z.object({ cli: z.enum(['codex', 'claude', 'opencode', 'pi']).default('codex'), model: z.string().min(1).max(200).optional() }).strict();
export const planInput = z.object({
  title: z.string().min(1).max(200),
  goal: z.string().min(1).max(16000),
  criteria: z.array(z.string().min(1).max(2000)).min(1).max(30),
  steps: z.array(z.string().min(1).max(2000)).min(1).max(40),
  implementer: profileSchema.default({ cli: 'codex' }),
  verifier: profileSchema.default({ cli: 'codex' })
}).strict();
export type PlanInput = z.infer<typeof planInput>;
export type Profile = z.infer<typeof profileSchema>;
const check = z.object({ command: z.string().trim().min(1), exitCode: z.number().int(), summary: z.string() }).strict();
export const implementationSchema = z.object({ summary: z.string().min(1), filesChanged: z.array(z.string()), checks: z.array(check), documentation: z.string(), limitations: z.array(z.string()) }).strict();
export const verificationSchema = z.object({
  outcome: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), summary: z.string().min(1),
  criteria: z.array(z.object({ id: z.string(), status: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), evidence: z.string().min(1) }).strict()),
  checks: z.array(check).describe('Required acceptance validation commands only: tests, linters or similar checks. Do not include inventory or inspection commands such as pwd, cat, rg, git status, or git log. PASS requires every listed validation command to succeed.'), issues: z.array(z.string())
}).strict();
export type Implementation = z.infer<typeof implementationSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type Phase = 'AWAITING_PLAN_APPROVAL' | 'BUILDING' | 'VERIFYING' | 'AWAITING_REPAIR_APPROVAL' | 'AWAITING_DELIVERY_APPROVAL' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
export type Snapshot = { hash: string; files: Record<string, string>; git: string };
export type Plan = PlanInput & { version: number; hash: string };
export type CommandEvidence = { command: string; exitCode: number | null; output: string };
export type RunRecord = { id: string; role: 'implementer' | 'verifier'; profile: Profile; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED' | 'UNKNOWN'; ownerPid: number; childPid?: number; terminalId?: string; lifecycle?: string; sessionId?: string; startedAt: string; finishedAt?: string; directory: string; commands?: CommandEvidence[]; error?: string };
export type Approval = { kind: 'plan' | 'repair' | 'delivery' | 'resume'; hash: string; time: string; source: 'mcp-elicitation' | 'terminal' | 'test-client' };
export type Workflow = {
  id: string; root: string; phase: Phase; revision: number; plan: Plan; baseline: Snapshot;
  approvals: Approval[]; runs: RunRecord[]; repairRound: number; implementation?: Implementation; verification?: Verification;
  verifiedSnapshot?: Snapshot; lastSnapshot?: Snapshot; repairHash?: string; blockedReason?: string;
  repairIssues?: string[];
  executionOwnerPid?: number;
  coordinatorTerminalId?: string;
  resumePhase?: 'BUILDING' | 'VERIFYING'; pendingStop?: boolean; createdAt: string; updatedAt: string;
};
export const terminalPhases: Phase[] = ['COMPLETED', 'CANCELLED', 'FAILED'];
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
