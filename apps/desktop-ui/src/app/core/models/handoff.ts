import type { AgentSession } from './agent.models';
import type { PromptAsset } from './prompt-assets';
import { redactSensitiveContent } from './prompt-assets';
import { stripTerminalControl } from './terminal-output';
import type { TerminalSession, Workspace } from './workspace.models';

export interface GitContext {
  available: boolean;
  branch: string;
  status: string;
  changedFiles: string[];
  diff: string;
  recentCommits: string[];
  truncated: boolean;
  diagnostic: string;
}

export interface HandoffSource {
  terminalId: string;
  terminalName: string;
  agentType: 'claude' | 'codex' | 'opencode';
  model: string;
  status: string;
  nativeSessionId?: string;
  sessionSummary?: string;
}

export interface HandoffPackage {
  format: 'termexo-handoff';
  version: 1;
  id: string;
  title: string;
  createdAt: number;
  workspaceId: string;
  workspaceName: string;
  projectPath: string;
  scope: 'terminal' | 'workspace';
  sourceTerminalId?: string;
  task: string;
  summary: string;
  completed: string[];
  pending: string[];
  decisions: string[];
  changedFiles: string[];
  gitBranch: string;
  gitStatus: string;
  gitDiff: string;
  recentCommits: string[];
  validation: string[];
  risks: string[];
  nextAction: string;
  recentPrompts: string[];
  terminalOutput: string;
  sources: HandoffSource[];
  tokenBudget: number;
  estimatedTokens: number;
  redactions: number;
  truncated: boolean;
}

export interface HandoffRecord {
  id: string;
  workspaceId: string;
  sourceTerminalId?: string;
  title: string;
  packageJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface HandoffBuildInput {
  workspace: Workspace;
  terminals: TerminalSession[];
  sourceTerminalId?: string;
  scope: 'terminal' | 'workspace';
  promptAssets: PromptAsset[];
  agentSessions: AgentSession[];
  outputByTerminal: ReadonlyMap<string, string>;
  git: GitContext;
  tokenBudget: number;
  now?: number;
  id?: string;
}

export function buildHandoffPackage(input: HandoffBuildInput): HandoffPackage {
  const now = input.now ?? Date.now();
  const budget = Math.min(32_000, Math.max(512, Math.round(input.tokenBudget)));
  const terminals = input.terminals.filter(
    (terminal): terminal is TerminalSession & { agentType: 'claude' | 'codex' | 'opencode' } =>
      terminal.agentType !== 'shell' &&
      (input.scope === 'workspace' || terminal.id === input.sourceTerminalId),
  );
  const terminalIds = new Set(terminals.map((terminal) => terminal.id));
  const recentPrompts = input.promptAssets
    .filter(
      (asset) =>
        asset.workspaceId === input.workspace.id &&
        asset.kind === 'history' &&
        (!asset.terminalId || terminalIds.has(asset.terminalId)),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 12)
    .map((asset) => asset.content);
  const draft = input.promptAssets
    .filter(
      (asset) =>
        asset.workspaceId === input.workspace.id &&
        asset.kind === 'draft' &&
        (!asset.terminalId || terminalIds.has(asset.terminalId)),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]?.content;
  const rawOutput = terminals
    .map((terminal) => {
      const output = stripTerminalControl(input.outputByTerminal.get(terminal.id) ?? '').trim();
      return output ? `## ${terminal.name} (${terminal.agentType})\n${output}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
  const sources = terminals.map((terminal) => {
    const native = input.agentSessions.find(
      (session) =>
        session.agentType === terminal.agentType &&
        session.nativeSessionId === terminal.nativeSessionId,
    );
    return {
      terminalId: terminal.id,
      terminalName: terminal.name,
      agentType: terminal.agentType,
      model: terminal.model,
      status: terminal.status,
      ...(terminal.nativeSessionId ? { nativeSessionId: terminal.nativeSessionId } : {}),
      ...(native?.summary ? { sessionSummary: native.summary } : {}),
    };
  });
  const evidence = [
    recentPrompts.join('\n'),
    rawOutput,
    ...sources.map((source) => source.sessionSummary ?? ''),
  ]
    .filter(Boolean)
    .join('\n');
  const completed = extractEvidence(
    evidence,
    /(?:completed|done|finished|passed|已完成|完成了|通过)/i,
  );
  const pending = extractEvidence(
    evidence,
    /(?:todo|pending|next|remaining|待办|下一步|尚未|未完成)/i,
  );
  const decisions = extractEvidence(
    evidence,
    /(?:decision|decided|choose|selected|决定|选择|采用)/i,
  );
  const validation = extractEvidence(evidence, /(?:test|spec|build|lint|cargo|测试|构建|检查)/i);
  const risks = extractEvidence(
    evidence,
    /(?:risk|warning|blocked|failed|error|风险|警告|阻塞|失败)/i,
  );
  const task = draft?.trim() || recentPrompts[0]?.trim() || `Continue ${input.workspace.name}`;
  const summaries = sources.map((source) => source.sessionSummary?.trim()).filter(Boolean);
  const summary =
    summaries.join(' ') ||
    completed.slice(0, 3).join(' ') ||
    `Handoff from ${terminals.length} active agent terminal${terminals.length === 1 ? '' : 's'}.`;
  const pendingWithDraft = unique([...(draft ? [draft] : []), ...pending]).slice(0, 12);

  let redactions = 0;
  const sanitize = (value: string): string => {
    const result = redactSensitiveContent(value);
    redactions += result.redactions;
    return result.content;
  };
  const sanitizeList = (values: string[]): string[] => values.map(sanitize);

  const handoff: HandoffPackage = {
    format: 'termexo-handoff',
    version: 1,
    id: input.id ?? createId(),
    title: `${input.workspace.name} · ${new Date(now).toLocaleString()}`,
    createdAt: now,
    workspaceId: input.workspace.id,
    workspaceName: sanitize(input.workspace.name),
    projectPath: sanitize(input.workspace.projectPath),
    scope: input.scope,
    sourceTerminalId: input.scope === 'terminal' ? input.sourceTerminalId : undefined,
    task: sanitize(task),
    summary: sanitize(summary),
    completed: sanitizeList(completed),
    pending: sanitizeList(pendingWithDraft),
    decisions: sanitizeList(decisions),
    changedFiles: sanitizeList(input.git.changedFiles),
    gitBranch: sanitize(input.git.branch),
    gitStatus: sanitize(input.git.status),
    gitDiff: sanitize(input.git.diff),
    recentCommits: sanitizeList(input.git.recentCommits),
    validation: sanitizeList(validation),
    risks: sanitizeList(risks),
    nextAction: sanitize(pendingWithDraft[0] || task),
    recentPrompts: sanitizeList(recentPrompts),
    terminalOutput: sanitize(rawOutput),
    sources: sources.map((source) => ({
      ...source,
      terminalName: sanitize(source.terminalName),
      model: sanitize(source.model),
      ...(source.sessionSummary ? { sessionSummary: sanitize(source.sessionSummary) } : {}),
    })),
    tokenBudget: budget,
    estimatedTokens: 0,
    redactions: 0,
    truncated: input.git.truncated,
  };

  enforceTokenBudget(handoff);
  handoff.redactions = redactions;
  handoff.estimatedTokens = estimateTokens(JSON.stringify(handoff));
  return handoff;
}

export function handoffToMarkdown(handoff: HandoffPackage, includeMachineData = true): string {
  const section = (title: string, values: readonly string[]): string =>
    `## ${title}\n${values.length ? values.map((value) => `- ${value}`).join('\n') : '- None recorded'}`;
  const markdown = [
    `# ${handoff.title}`,
    `> Termexo handoff v${handoff.version} · ${handoff.scope} · ~${handoff.estimatedTokens}/${handoff.tokenBudget} tokens`,
    '## Task',
    handoff.task,
    '## Summary',
    handoff.summary,
    section('Completed', handoff.completed),
    section('Pending', handoff.pending),
    section('Decisions', handoff.decisions),
    section('Changed files', handoff.changedFiles),
    '## Git status',
    `Branch: ${handoff.gitBranch || 'unknown'}\n\n\`\`\`text\n${handoff.gitStatus || 'No status available'}\n\`\`\``,
    '## Git diff',
    `\`\`\`diff\n${handoff.gitDiff || 'No diff captured'}\n\`\`\``,
    section('Validation', handoff.validation),
    section('Risks', handoff.risks),
    '## Next action',
    handoff.nextAction,
    '## Source sessions',
    handoff.sources
      .map(
        (source) =>
          `- ${source.terminalName} · ${source.agentType} · ${source.model} · ${source.status}`,
      )
      .join('\n') || '- None recorded',
  ].join('\n\n');

  return includeMachineData
    ? `${markdown}\n\n<!-- TERMEXO_HANDOFF_DATA ${encodeURIComponent(JSON.stringify(handoff))} -->\n`
    : markdown;
}

export function parseHandoffDocument(value: string): HandoffPackage {
  const trimmed = value.trim();
  if (trimmed.length > 2 * 1024 * 1024) {
    throw new Error('The handoff document exceeds the 2 MB safety limit.');
  }
  let parsed: unknown;
  if (trimmed.startsWith('{')) {
    parsed = JSON.parse(trimmed);
  } else {
    const match = trimmed.match(/<!-- TERMEXO_HANDOFF_DATA\s+([^\s]+)\s+-->/);
    if (!match) {
      throw new Error('This Markdown file does not contain Termexo handoff data.');
    }
    parsed = JSON.parse(decodeURIComponent(match[1]));
  }
  if (!isHandoffPackage(parsed)) {
    throw new Error('The handoff document format is invalid or unsupported.');
  }
  return sanitizeImportedHandoff(parsed);
}

export function continuationPrompt(handoff: HandoffPackage): string {
  return [
    'Continue this task from the Termexo handoff below.',
    'Verify the current repository state before editing. Preserve unrelated worktree changes.',
    'Complete the next action, run relevant tests, and report any remaining risk.',
    '',
    handoffToMarkdown(handoff, false),
  ].join('\n');
}

/**
 * Whether the package carries anything the receiving Agent can actually work from.
 *
 * Task and summary always have a value because they fall back to the workspace name, so a
 * package can look complete while holding nothing but that fallback. Only the evidence fields
 * count: what was done, what is left, what changed on disk, and what the terminals said.
 */
export function hasSubstantiveContext(handoff: HandoffPackage): boolean {
  return (
    handoff.completed.length > 0 ||
    handoff.pending.length > 0 ||
    handoff.decisions.length > 0 ||
    handoff.changedFiles.length > 0 ||
    handoff.validation.length > 0 ||
    handoff.risks.length > 0 ||
    handoff.recentPrompts.length > 0 ||
    handoff.gitDiff.trim().length > 0 ||
    handoff.terminalOutput.trim().length > 0
  );
}

export function estimateTokens(value: string): number {
  return Math.ceil(Array.from(value).length / 4);
}

function enforceTokenBudget(handoff: HandoffPackage): void {
  const withinBudget = (): boolean =>
    estimateTokens(JSON.stringify(handoff)) <= handoff.tokenBudget;
  const shrink = (value: string): string => {
    const characters = Array.from(value);
    if (characters.length <= 256) {
      return '';
    }
    handoff.truncated = true;
    return `${characters.slice(0, Math.max(128, Math.floor(characters.length * 0.7))).join('')}\n[truncated]`;
  };

  while (!withinBudget() && (handoff.gitDiff || handoff.terminalOutput)) {
    if (handoff.gitDiff.length >= handoff.terminalOutput.length) {
      handoff.gitDiff = shrink(handoff.gitDiff);
    } else {
      handoff.terminalOutput = shrink(handoff.terminalOutput);
    }
  }
  while (!withinBudget() && handoff.recentPrompts.length > 2) {
    handoff.recentPrompts.pop();
    handoff.truncated = true;
  }
  while (!withinBudget() && handoff.pending.length > 3) {
    handoff.pending.pop();
    handoff.truncated = true;
  }
  for (const values of [
    handoff.completed,
    handoff.pending,
    handoff.decisions,
    handoff.changedFiles,
    handoff.recentCommits,
    handoff.validation,
    handoff.risks,
    handoff.recentPrompts,
  ]) {
    while (!withinBudget() && values.length > 1) {
      values.pop();
      handoff.truncated = true;
    }
  }
  for (const source of handoff.sources) {
    if (!withinBudget() && source.sessionSummary) {
      source.sessionSummary = '';
      handoff.truncated = true;
    }
  }
  while (!withinBudget() && handoff.sources.length > 1) {
    handoff.sources.pop();
    handoff.truncated = true;
  }
  for (const field of ['gitStatus', 'summary', 'task', 'nextAction'] as const) {
    while (!withinBudget() && handoff[field].length > 128) {
      handoff[field] = shrink(handoff[field]);
    }
  }
  handoff.estimatedTokens = estimateTokens(JSON.stringify(handoff));
}

function extractEvidence(value: string, pattern: RegExp): string[] {
  return unique(
    value
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*#>\s]+/, '').trim())
      .filter((line) => line.length >= 4 && line.length <= 280 && pattern.test(line)),
  ).slice(0, 12);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function createId(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `handoff:${suffix}`;
}

function isHandoffPackage(value: unknown): value is HandoffPackage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<HandoffPackage>;
  return (
    candidate.format === 'termexo-handoff' &&
    candidate.version === 1 &&
    typeof candidate.id === 'string' &&
    candidate.id.length <= 256 &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.workspaceName === 'string' &&
    typeof candidate.projectPath === 'string' &&
    (candidate.scope === 'terminal' || candidate.scope === 'workspace') &&
    typeof candidate.task === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.nextAction === 'string' &&
    typeof candidate.tokenBudget === 'number' &&
    candidate.tokenBudget >= 512 &&
    candidate.tokenBudget <= 32_000 &&
    typeof candidate.estimatedTokens === 'number' &&
    [
      candidate.completed,
      candidate.pending,
      candidate.decisions,
      candidate.changedFiles,
      candidate.recentCommits,
      candidate.validation,
      candidate.risks,
      candidate.recentPrompts,
    ].every(isStringArray) &&
    Array.isArray(candidate.sources) &&
    candidate.sources.length <= 128 &&
    candidate.sources.every(
      (source) =>
        source &&
        typeof source === 'object' &&
        typeof source.terminalId === 'string' &&
        typeof source.terminalName === 'string' &&
        ['claude', 'codex', 'opencode'].includes(source.agentType) &&
        typeof source.model === 'string' &&
        typeof source.status === 'string',
    )
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length <= 1_000 && value.every((item) => typeof item === 'string')
  );
}

function sanitizeImportedHandoff(handoff: HandoffPackage): HandoffPackage {
  let redactions = 0;
  const sanitize = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const result = redactSensitiveContent(value);
      redactions += result.redactions;
      return result.content;
    }
    if (Array.isArray(value)) {
      return value.map(sanitize);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, sanitize(child)]),
      );
    }
    return value;
  };
  const sanitized = sanitize(handoff) as HandoffPackage;
  sanitized.redactions = Math.max(0, handoff.redactions || 0) + redactions;
  enforceTokenBudget(sanitized);
  sanitized.estimatedTokens = estimateTokens(JSON.stringify(sanitized));
  return sanitized;
}
