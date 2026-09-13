import type { AgentType } from '../core/models/workspace.models';
import {
  detectTerminalRuntimeIssue,
  readsRuntimeIssuesFromOutput,
} from './terminal-runtime-diagnostics';

const ALL_AGENTS: readonly AgentType[] = ['claude', 'codex', 'opencode', 'antigravity', 'shell'];

/** Ordinary output that mentions the words an error would use, from the diagnostics audit. */
const BENIGN_OUTPUT: Readonly<Record<string, string>> = {
  claudeReadsCode: "  659   'agent.rate_limited': 'RATE_LIMITED',",
  diffComment: '+ // Retry the request after a timeout so a slow proxy is not fatal',
  fetchOption: '  const response = await fetch(url, { signal, timeout: 5_000 }); // api call',
  docsSentence: 'The API returns 429 Too Many Requests when the limit is exceeded.',
  rustTest: 'test hooks::tests::maps_rate_limit_stop_failure ... ok',
  grepHit: 'src/remote/token.rs:29: throttles repeated failures, rate-limited per source',
  connectionTimeoutProse: 'Set the connection timeout in settings.json',
};

describe('terminal runtime diagnostics', () => {
  for (const [name, text] of Object.entries(BENIGN_OUTPUT)) {
    it(`leaves benign output alone for every agent: ${name}`, () => {
      for (const agentType of ALL_AGENTS) {
        expect(detectTerminalRuntimeIssue(text, agentType)).toBeNull();
      }
    });
  }

  it('reads only the agents that report these failures through no event', () => {
    expect(ALL_AGENTS.filter(readsRuntimeIssuesFromOutput)).toEqual(['codex', 'antigravity']);
  });

  it('leaves Claude Code to its StopFailure hook, even for its own error lines', () => {
    expect(
      detectTerminalRuntimeIssue(
        '● API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
        'claude',
      ),
    ).toBeNull();
    expect(detectTerminalRuntimeIssue('● API Error: Request timed out.', 'claude')).toBeNull();
  });

  it('never reads a plain shell', () => {
    expect(
      detectTerminalRuntimeIssue('■ exceeded retry limit, last status: 429', 'shell'),
    ).toBeNull();
  });

  describe('Codex CLI', () => {
    it('recognizes a turn that ended on a rate limit', () => {
      expect(
        detectTerminalRuntimeIssue(
          '\u001b[34;3H\u001b[31m■ \u001b[39mexceeded retry limit, last status: 429 Too Many Requests\u001b[36;1H› Ask Codex to do anything',
          'codex',
        ),
      ).toBe('rate-limit');
      expect(
        detectTerminalRuntimeIssue(
          "\r\n■ You've hit your usage limit. Try again at 3:05 PM.\r\n",
          'codex',
        ),
      ).toBe('rate-limit');
    });

    it('recognizes a stream retried for a rate limit', () => {
      expect(
        detectTerminalRuntimeIssue(
          ' ◦ Reconnecting... 1/5 (3s • esc to interrupt)\r\n  └ Stream disconnected before completion: Rate limit reached for gpt-5 in organization org-1 on tokens per min.',
          'codex',
        ),
      ).toBe('rate-limit');
    });

    it('recognizes a stream that timed out', () => {
      expect(
        detectTerminalRuntimeIssue(
          ' ◦ Reconnecting... 2/5 (10s • esc to interrupt)\u001b[33;3H└ Stream disconnected before completion: idle timeout waiting for SSE',
          'codex',
        ),
      ).toBe('timeout');
    });

    it('reports the error object of a rejected request as a failure', () => {
      // Recorded from Codex 0.154 with an unsupported model; no Stop or failure hook followed it.
      expect(
        detectTerminalRuntimeIssue(
          '\r\n\r\n■ {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'termexo-invalid-model\' model is\r\nnot supported when using Codex with a ChatGPT account."}}',
          'codex',
        ),
      ).toBe('failed');
    });

    it("lets an error object's status code decide over its message", () => {
      expect(
        detectTerminalRuntimeIssue(
          '■ {"type":"error","status":429,"error":{"type":"invalid_request_error","message":"Slow down"}}',
          'codex',
        ),
      ).toBe('rate-limit');
      expect(
        detectTerminalRuntimeIssue(
          '■ {"type":"error","status":400,"error":{"message":"timeout must be a positive integer"}}',
          'codex',
        ),
      ).toBe('failed');
    });

    it('does not take an error object Codex did not print as its own error line', () => {
      expect(
        detectTerminalRuntimeIssue(
          '  └ tests/fixtures/error.json:1 {"type":"error","status":400,"error":{"type":"invalid_request_error"}}',
          'codex',
        ),
      ).toBeNull();
    });

    it('does not classify the network failure recorded in the lab', () => {
      expect(
        detectTerminalRuntimeIssue(
          ' ◦ Reconnecting... waiting for network (37s • esc to interrupt)  └ Connection failed: error sending request  › Ask Codex to do anything',
          'codex',
        ),
      ).toBeNull();
    });

    it('does not read command output behind the tree prefix Codex draws for every command', () => {
      expect(
        detectTerminalRuntimeIssue(
          "• Ran rg rate_limited\r\n  └ src/app.ts:659   'agent.rate_limited': 'RATE_LIMITED',",
          'codex',
        ),
      ).toBeNull();
    });

    it('does not join an error line to text drawn on another row afterwards', () => {
      expect(
        detectTerminalRuntimeIssue(
          '■ Conversation interrupted - tell the model what to do differently.\u001b[36;3Hhandle 429 rate limit errors',
          'codex',
        ),
      ).toBeNull();
    });
  });

  describe('Antigravity CLI', () => {
    it('recognizes an executor error for an exhausted quota', () => {
      expect(
        detectTerminalRuntimeIssue(
          '\r\n⚠ agent executor error: generating and executing: Error 429, Message: Resource has been exhausted, Status: RESOURCE_EXHAUSTED, Details: []\r\nError ID: 1-1\r\n',
          'antigravity',
        ),
      ).toBe('rate-limit');
    });

    it('recognizes an executor error for a deadline', () => {
      expect(
        detectTerminalRuntimeIssue(
          '\r\n⚠ agent executor error: generating and executing: Error 504, Message: upstream deadline, Status: DEADLINE_EXCEEDED, Details: []\r\n',
          'antigravity',
        ),
      ).toBe('timeout');
    });

    it('does not classify the server and network errors recorded in the lab', () => {
      expect(
        detectTerminalRuntimeIssue(
          '\r\n⚠ agent executor error: generating and executing: Error 500, Message: lab internal error, Status: INTERNAL, Details: []\r\nError ID: 2725c798-1\r\n',
          'antigravity',
        ),
      ).toBeNull();
      expect(
        detectTerminalRuntimeIssue(
          '\r\n⚠ There was a network issue connecting to the server, please try again.\r\nError ID: faf9e641-1\r\n',
          'antigravity',
        ),
      ).toBeNull();
    });
  });
});
