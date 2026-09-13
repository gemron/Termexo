import type { AgentType, TerminalStatus } from '../core/models/workspace.models';

/**
 * Sequences that put the cursor on another row.
 *
 * A full-screen agent draws each row by positioning the cursor rather than printing a newline, so
 * these are what separate one row from the next. Reading them as line breaks keeps an error
 * pattern from joining an error line to whatever the agent draws next — the prompt the user is
 * typing, above all.
 */
const ROW_CHANGING_SEQUENCE = /\u001b\[[0-9;?]*[ABEFHdf]|\u001b[78DEM]/g;
const ANSI_ESCAPE_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

/** How much of the latest output is searched, enough for an error line and the redraw after it. */
export const RUNTIME_ISSUE_OUTPUT_WINDOW = 2_000;

export type TerminalRuntimeIssue = 'rate-limit' | 'timeout' | 'failed' | null;

/** The status each issue puts the terminal in. */
export const RUNTIME_ISSUE_STATUS: Readonly<
  Record<Exclude<TerminalRuntimeIssue, null>, TerminalStatus>
> = {
  'rate-limit': 'RATE_LIMITED',
  timeout: 'WAITING_INPUT',
  failed: 'FAILED',
};

/** One error line an agent prints, and the issue it means. */
interface RuntimeIssueRule {
  readonly issue: Exclude<TerminalRuntimeIssue, null>;
  readonly pattern: RegExp;
}

/**
 * The provider's error object Codex CLI prints when a request is rejected outright:
 * `■ {"type":"error","status":400,"error":{…}}`, followed by the status code.
 *
 * Codex 0.154 raises neither Stop nor any failure hook for it, so without this the terminal would
 * keep thinking forever.
 */
const CODEX_ERROR_OBJECT = String.raw`■\s*\{\s*"type"\s*:\s*"error"\s*,\s*"status"\s*:\s*`;

/**
 * Where Codex CLI states a failure itself, up to the end of that row.
 *
 * `■ <message>` is the error that ended a turn; `└ <reason>` sits under "Reconnecting..." while a
 * failed stream is retried. The `└` prefix alone is not enough, because Codex also puts it in front
 * of every command's output, so it has to be followed by one of Codex's own retry reasons.
 */
const CODEX_ERROR_LINE = String.raw`(?:■|└\s*(?:stream disconnected before completion|connection failed|error while reading the server response)\b)[^\r\n]{0,300}?`;

/**
 * Where Antigravity CLI states a failure itself:
 * `⚠ agent executor error: generating and executing: Error 500, Message: …, Status: INTERNAL`.
 */
const ANTIGRAVITY_ERROR_LINE = String.raw`agent executor error:[^\r\n]{0,300}?`;

/**
 * The error lines read per agent, for the agents that report these failures through no event.
 *
 * Claude Code is not read: its StopFailure hook carries a typed `error` (`rate_limit`,
 * `server_error`, …) for the same failure its screen shows, while its screen is where it quotes the
 * code it is working on — the source of every false alarm this reader used to raise. The OpenCode
 * plugin reports rate limits and timeouts from the session's retry status, and a plain shell has no
 * provider to fail. What remains is anchored to each CLI's own error line, never to the words alone.
 *
 * Rules are tried in order and the first match wins.
 */
const RUNTIME_ISSUE_RULES: Readonly<Partial<Record<AgentType, readonly RuntimeIssueRule[]>>> = {
  codex: [
    // An error object's status code outranks whatever its message happens to say.
    { issue: 'rate-limit', pattern: new RegExp(String.raw`${CODEX_ERROR_OBJECT}429\b`) },
    { issue: 'failed', pattern: new RegExp(String.raw`${CODEX_ERROR_OBJECT}\d{3}\b`) },
    {
      issue: 'rate-limit',
      pattern: new RegExp(
        String.raw`${CODEX_ERROR_LINE}(?:\b429\b|\brate[ _-]?limit|\btoo many requests\b|\busage limit\b|\bquota exceeded\b)`,
        'i',
      ),
    },
    {
      issue: 'timeout',
      pattern: new RegExp(String.raw`${CODEX_ERROR_LINE}\b(?:timed out|timeout)\b`, 'i'),
    },
  ],
  antigravity: [
    {
      issue: 'rate-limit',
      pattern: new RegExp(
        String.raw`${ANTIGRAVITY_ERROR_LINE}\b(?:Error 429|RESOURCE_EXHAUSTED)\b`,
      ),
    },
    {
      issue: 'timeout',
      pattern: new RegExp(String.raw`${ANTIGRAVITY_ERROR_LINE}\b(?:Error 504|DEADLINE_EXCEEDED)\b`),
    },
  ],
};

/** Whether this agent's output is read for runtime issues at all. */
export function readsRuntimeIssuesFromOutput(agentType: AgentType): boolean {
  return RUNTIME_ISSUE_RULES[agentType] !== undefined;
}

export function detectTerminalRuntimeIssue(
  output: string,
  agentType: AgentType,
): TerminalRuntimeIssue {
  const rules = RUNTIME_ISSUE_RULES[agentType];
  if (!rules) {
    return null;
  }
  const text = output.replace(ROW_CHANGING_SEQUENCE, '\n').replace(ANSI_ESCAPE_SEQUENCE, ' ');
  return rules.find((rule) => rule.pattern.test(text))?.issue ?? null;
}
