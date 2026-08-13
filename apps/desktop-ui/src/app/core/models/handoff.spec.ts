import { describe, expect, it } from 'vitest';

import type { PromptAsset } from './prompt-assets';
import { buildHandoffPackage, handoffToMarkdown, parseHandoffDocument } from './handoff';
import type { TerminalSession, Workspace } from './workspace.models';

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Termexo',
  projectPath: 'D:/devlop/Termexo',
  projectType: 'Rust + Angular',
  activeBranch: 'main',
  favorite: false,
  lastOpenedAt: 1,
  layout: 'single',
  terminals: [],
};
const terminal: TerminalSession = {
  id: 'terminal-1',
  name: 'Claude 1',
  workingDirectory: workspace.projectPath,
  shell: 'pwsh',
  agentType: 'claude',
  status: 'RUNNING',
  model: 'claude-sonnet',
  branch: 'main',
  nativeSessionId: 'native-1',
};
const prompt: PromptAsset = {
  id: 'prompt-1',
  workspaceId: workspace.id,
  terminalId: terminal.id,
  terminalName: terminal.name,
  agentType: 'claude',
  kind: 'history',
  content: 'Next: finish V0.5 and run all tests. api_key=abcdefghijklmnop',
  redacted: false,
  favorite: false,
  pinned: false,
  createdAt: 1,
  updatedAt: 2,
};

describe('handoff package', () => {
  it('contains the required task state and redacts credentials', () => {
    const handoff = buildHandoffPackage({
      workspace,
      terminals: [terminal],
      sourceTerminalId: terminal.id,
      scope: 'terminal',
      promptAssets: [prompt],
      agentSessions: [],
      outputByTerminal: new Map([
        [terminal.id, '\u001b[32mCompleted: composition fix\u001b[0m\nTests passed: 129'],
      ]),
      git: {
        available: true,
        branch: 'main',
        status: ' M app.ts',
        changedFiles: ['app.ts'],
        diff: '+const token = "sk-abcdefghijklmnop";',
        recentCommits: ['abc123 previous release'],
        truncated: false,
        diagnostic: '',
      },
      tokenBudget: 2_000,
      now: 1_700_000_000_000,
      id: 'handoff-1',
    });

    expect(handoff.task).toContain('finish V0.5');
    expect(handoff.completed).toContain('Completed: composition fix');
    expect(handoff.validation).toContain('Tests passed: 129');
    expect(handoff.changedFiles).toEqual(['app.ts']);
    expect(JSON.stringify(handoff)).not.toContain('abcdefghijklmnop');
    expect(handoff.redactions).toBeGreaterThan(0);
  });

  it('enforces the token budget by truncating bulky output and diff', () => {
    const handoff = buildHandoffPackage({
      workspace,
      terminals: [terminal],
      sourceTerminalId: terminal.id,
      scope: 'terminal',
      promptAssets: [prompt],
      agentSessions: [],
      outputByTerminal: new Map([[terminal.id, 'output '.repeat(8_000)]]),
      git: {
        available: true,
        branch: 'main',
        status: '',
        changedFiles: [],
        diff: 'diff '.repeat(8_000),
        recentCommits: [],
        truncated: false,
        diagnostic: '',
      },
      tokenBudget: 512,
    });

    expect(handoff.truncated).toBe(true);
    expect(handoff.estimatedTokens).toBeLessThanOrEqual(512);
  });

  it('round-trips through the readable Markdown document', () => {
    const handoff = buildHandoffPackage({
      workspace,
      terminals: [terminal],
      sourceTerminalId: terminal.id,
      scope: 'terminal',
      promptAssets: [prompt],
      agentSessions: [],
      outputByTerminal: new Map(),
      git: {
        available: false,
        branch: '',
        status: '',
        changedFiles: [],
        diff: '',
        recentCommits: [],
        truncated: false,
        diagnostic: '',
      },
      tokenBudget: 2_000,
      id: 'handoff-roundtrip',
    });

    expect(parseHandoffDocument(handoffToMarkdown(handoff))).toEqual(handoff);
    expect(parseHandoffDocument(JSON.stringify(handoff))).toEqual(handoff);
  });
});
