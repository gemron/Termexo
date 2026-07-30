import { detectTerminalRuntimeIssue } from './terminal-runtime-diagnostics';

describe('terminal runtime diagnostics', () => {
  it('recognizes provider rate limit output', () => {
    expect(detectTerminalRuntimeIssue('API Error: rate_limit (429 Too Many Requests)')).toBe(
      'rate-limit',
    );
  });

  it('recognizes request timeout output', () => {
    expect(detectTerminalRuntimeIssue('API request timed out while waiting for a response')).toBe(
      'timeout',
    );
  });

  it('does not classify unrelated numeric output as a provider failure', () => {
    expect(detectTerminalRuntimeIssue('Build completed. Processed 429 modules.')).toBeNull();
  });
});
