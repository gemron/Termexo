const ANSI_ESCAPE_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export type TerminalRuntimeIssue = 'rate-limit' | 'timeout' | null;

export function detectTerminalRuntimeIssue(output: string): TerminalRuntimeIssue {
  const text = output.replace(ANSI_ESCAPE_SEQUENCE, ' ');
  if (
    /\brate[_ -]?limit(?:ed)?\b/i.test(text) ||
    /\btoo many requests\b/i.test(text) ||
    /\b429\b[^\r\n]{0,120}\b(?:request|limit|overload)/i.test(text) ||
    /\b(?:request|limit|overload)[^\r\n]{0,120}\b429\b/i.test(text)
  ) {
    return 'rate-limit';
  }
  if (
    /\b(?:api|request|connection)[^\r\n]{0,80}\b(?:timed out|timeout)\b/i.test(text) ||
    /\b(?:timed out|timeout)\b[^\r\n]{0,80}\b(?:api|request|connection)\b/i.test(text)
  ) {
    return 'timeout';
  }
  return null;
}
