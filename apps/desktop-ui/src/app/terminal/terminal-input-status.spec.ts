import { vi } from 'vitest';

import type { AgentType, TerminalStatus } from '../core/models/workspace.models';
import {
  type ApprovalOption,
  isSubmission,
  readApprovalOptions,
  TerminalInputStatusTracker,
} from './terminal-input-status';

const ESCAPE = '\u001b';
const ARROW_DOWN = '\u001b[B';

/** Claude Code 2.1.270's permission dialog as the lab recorded it, pointer on `selected`. */
function claudePermissionDialog(selected = 1): string[] {
  const pointer = (number: number) => (number === selected ? '>' : ' ');
  return [
    '────────────────────────────────────────',
    ' PowerShell command',
    '',
    '   Set-Content -Path deny-lab.txt -Value termexo-lab',
    '   Create file deny-lab.txt with content termexo-lab',
    '',
    ' Do you want to proceed?',
    ` ${pointer(1)} 1. Yes`,
    ` ${pointer(2)} 2. Yes, and always allow access to C:\\Users\\gemro\\AppData\\Local\\Temp\\claude`,
    '-5b9dad0c39d5\\scratchpad\\hooklab-claude\\work from this project',
    ` ${pointer(3)} 3. No`,
    '',
    ' Esc to cancel · Tab to amend',
    '',
  ];
}

/** Codex CLI 0.154's command approval as the lab recorded it, option 2 wrapped onto two rows. */
function codexApprovalDialog(selected = 1): string[] {
  const pointer = (number: number) => (number === selected ? '›' : ' ');
  return [
    '  Would you like to run the following command?',
    '',
    '  Reason: hook lab',
    '',
    '  $ echo termexo-lab',
    '',
    `${pointer(1)} 1. Yes, proceed (y)`,
    `${pointer(2)} 2. Yes, and don't ask again for commands that start with`,
    '     `echo termexo-lab` (p)',
    `${pointer(3)} 3. No, and tell Codex what to do differently (esc)`,
    '',
    '  Press enter to confirm or esc to cancel',
  ];
}

const CLAUDE_PERMISSION_DIALOG = claudePermissionDialog();
const CODEX_APPROVAL_DIALOG = codexApprovalDialog();

/** Claude Code's question dialog, whose answers are neither approvals nor refusals. */
const CLAUDE_QUESTION_DIALOG = [
  ' Which colour do you prefer?',
  ' > 1. Red',
  '   2. Blue',
  '   3. Type something.',
  '   4. Chat about this',
  ' Enter to select · ↑/↓ to navigate · Esc to cancel',
];

function statusAfter(
  data: string,
  agentType: AgentType,
  status: TerminalStatus,
  screen: readonly string[] = [],
  tracker = new TerminalInputStatusTracker(),
): TerminalStatus | null {
  return tracker.statusAfterInput(data, {
    agentType,
    status,
    readApprovalOptions: () => readApprovalOptions(screen),
  });
}

describe('isSubmission', () => {
  it('treats input carrying Enter as a submission', () => {
    expect(isSubmission('\r')).toBe(true);
    expect(isSubmission('fix the build\r')).toBe(true);
    expect(isSubmission('fix the build')).toBe(false);
  });
});

describe('readApprovalOptions', () => {
  it("reads Claude Code's permission dialog, pointer and wrapped label included", () => {
    expect(readApprovalOptions(CLAUDE_PERMISSION_DIALOG)).toEqual<ApprovalOption[]>([
      { number: 1, approves: true, selected: true, shortcut: null },
      { number: 2, approves: true, selected: false, shortcut: null },
      { number: 3, approves: false, selected: false, shortcut: null },
    ]);
  });

  it("reads Codex CLI's shortcuts, including one wrapped onto the next row", () => {
    expect(readApprovalOptions(CODEX_APPROVAL_DIALOG)).toEqual<ApprovalOption[]>([
      { number: 1, approves: true, selected: true, shortcut: 'y' },
      { number: 2, approves: true, selected: false, shortcut: 'p' },
      { number: 3, approves: false, selected: false, shortcut: null },
    ]);
  });

  it('reads a dialog drawn inside a frame', () => {
    expect(readApprovalOptions(['│ ❯ 1. Yes      │', '│   2. No       │'])).toEqual<
      ApprovalOption[]
    >([
      { number: 1, approves: true, selected: true, shortcut: null },
      { number: 2, approves: false, selected: false, shortcut: null },
    ]);
  });

  it('takes the lowest list on screen and ignores numbered output above it', () => {
    const options = readApprovalOptions([
      'Plan:',
      '1. No changes to the schema',
      '2. Yes, migrate the table',
      '',
      ...CLAUDE_PERMISSION_DIALOG,
    ]);
    expect(options.map((option) => option.number)).toEqual([1, 2, 3]);
    expect(options[0].approves).toBe(true);
  });

  it('reads no dialog from a list that does not count down to option 1', () => {
    expect(readApprovalOptions(['  3. No', ''])).toEqual([]);
    expect(readApprovalOptions(['  1. Yes', '', '', '', '', '', '  2. No'])).toEqual([]);
    expect(readApprovalOptions(['nothing numbered here'])).toEqual([]);
  });
});

describe('TerminalInputStatusTracker', () => {
  describe('Esc', () => {
    it('returns an interrupted Claude Code or Codex CLI turn to idle', () => {
      for (const agentType of ['claude', 'codex'] as const) {
        for (const status of ['THINKING', 'RUNNING', 'WAITING_APPROVAL'] as const) {
          expect(statusAfter(ESCAPE, agentType, status)).toBe('IDLE');
        }
      }
    });

    it('changes nothing when no turn or approval is in progress', () => {
      for (const status of ['IDLE', 'COMPLETED', 'WAITING_INPUT', 'FAILED'] as const) {
        expect(statusAfter(ESCAPE, 'claude', status)).toBeNull();
      }
    });

    it('leaves agents that report interrupts themselves, and shells, alone', () => {
      for (const agentType of ['opencode', 'antigravity', 'shell'] as const) {
        expect(statusAfter(ESCAPE, agentType, 'THINKING')).toBeNull();
      }
    });

    it('does not mistake an escape sequence for the Esc key', () => {
      expect(statusAfter(ARROW_DOWN, 'claude', 'THINKING')).toBeNull();
      expect(statusAfter('\u001bb', 'codex', 'RUNNING')).toBeNull();
    });
  });

  describe('Enter', () => {
    it('keeps moving a submitted prompt to thinking, or running for a shell', () => {
      expect(statusAfter('\r', 'claude', 'IDLE')).toBe('THINKING');
      expect(statusAfter('\r', 'codex', 'COMPLETED')).toBe('THINKING');
      expect(statusAfter('\r', 'opencode', 'WAITING_APPROVAL')).toBe('THINKING');
      expect(statusAfter('\r', 'antigravity', 'IDLE')).toBe('THINKING');
      expect(statusAfter('ls\r', 'shell', 'IDLE')).toBe('RUNNING');
    });

    it('runs the tool when an approval is confirmed', () => {
      expect(statusAfter('\r', 'claude', 'WAITING_APPROVAL', CLAUDE_PERMISSION_DIALOG)).toBe(
        'RUNNING',
      );
      expect(statusAfter('\r', 'codex', 'WAITING_APPROVAL', CODEX_APPROVAL_DIALOG)).toBe('RUNNING');
    });

    it('assumes an approval when no dialog can be read', () => {
      expect(statusAfter('\r', 'claude', 'WAITING_APPROVAL')).toBe('RUNNING');
      expect(statusAfter('\r', 'claude', 'WAITING_APPROVAL', CLAUDE_QUESTION_DIALOG)).toBe(
        'RUNNING',
      );
    });

    it('returns to idle when the highlighted option refuses', () => {
      expect(statusAfter('\r', 'claude', 'WAITING_APPROVAL', claudePermissionDialog(3))).toBe(
        'IDLE',
      );
      expect(statusAfter('\r', 'codex', 'WAITING_APPROVAL', codexApprovalDialog(3))).toBe('IDLE');
      expect(statusAfter('\r', 'codex', 'WAITING_APPROVAL', codexApprovalDialog(2))).toBe(
        'RUNNING',
      );
    });
  });

  describe('answering an approval without Enter', () => {
    it("runs the tool for Claude Code's approving numbers", () => {
      expect(statusAfter('1', 'claude', 'WAITING_APPROVAL', CLAUDE_PERMISSION_DIALOG)).toBe(
        'RUNNING',
      );
      expect(statusAfter('2', 'claude', 'WAITING_APPROVAL', CLAUDE_PERMISSION_DIALOG)).toBe(
        'RUNNING',
      );
    });

    it("returns to idle for Claude Code's refusing number, wherever the dialog puts it", () => {
      expect(statusAfter('3', 'claude', 'WAITING_APPROVAL', CLAUDE_PERMISSION_DIALOG)).toBe('IDLE');
      const twoOptionDialog = [' Do you want to proceed?', ' > 1. Yes', '   2. No'];
      expect(statusAfter('2', 'claude', 'WAITING_APPROVAL', twoOptionDialog)).toBe('IDLE');
      expect(statusAfter('3', 'claude', 'WAITING_APPROVAL', twoOptionDialog)).toBeNull();
    });

    it("runs the tool for the shortcuts and approving numbers Codex CLI's dialog prints", () => {
      for (const key of ['y', 'p', '1', '2']) {
        expect(statusAfter(key, 'codex', 'WAITING_APPROVAL', CODEX_APPROVAL_DIALOG)).toBe(
          'RUNNING',
        );
      }
    });

    it("returns to idle for Codex CLI's refusing number", () => {
      expect(statusAfter('3', 'codex', 'WAITING_APPROVAL', CODEX_APPROVAL_DIALOG)).toBe('IDLE');
    });

    it('changes nothing for keys the dialog does not offer', () => {
      expect(statusAfter('n', 'codex', 'WAITING_APPROVAL', CODEX_APPROVAL_DIALOG)).toBeNull();
      expect(statusAfter('4', 'codex', 'WAITING_APPROVAL', CODEX_APPROVAL_DIALOG)).toBeNull();
      expect(statusAfter('y', 'claude', 'WAITING_APPROVAL', CLAUDE_PERMISSION_DIALOG)).toBeNull();
      expect(statusAfter('1', 'claude', 'WAITING_APPROVAL')).toBeNull();
    });

    it('changes nothing for an answer that is neither an approval nor a refusal', () => {
      expect(statusAfter('1', 'claude', 'WAITING_APPROVAL', CLAUDE_QUESTION_DIALOG)).toBeNull();
      expect(statusAfter('3', 'claude', 'WAITING_APPROVAL', CLAUDE_QUESTION_DIALOG)).toBeNull();
    });

    it('changes nothing for arrows, without reading the screen', () => {
      const readOptions = vi.fn(() => readApprovalOptions(CLAUDE_PERMISSION_DIALOG));
      const status = new TerminalInputStatusTracker().statusAfterInput(ARROW_DOWN, {
        agentType: 'claude',
        status: 'WAITING_APPROVAL',
        readApprovalOptions: readOptions,
      });
      expect(status).toBeNull();
      expect(readOptions).not.toHaveBeenCalled();
    });

    it('does not read the screen for ordinary typing', () => {
      const readOptions = vi.fn((): ApprovalOption[] => []);
      const tracker = new TerminalInputStatusTracker();
      for (const status of ['THINKING', 'IDLE'] as const) {
        tracker.statusAfterInput('1', {
          agentType: 'claude',
          status,
          readApprovalOptions: readOptions,
        });
      }
      expect(readOptions).not.toHaveBeenCalled();
    });

    it("treats digits typed into Claude Code's amend field as text until the answer is sent", () => {
      const tracker = new TerminalInputStatusTracker();
      const answer = (data: string) =>
        statusAfter(data, 'claude', 'WAITING_APPROVAL', CLAUDE_PERMISSION_DIALOG, tracker);
      expect(answer('\t')).toBeNull();
      expect(answer('3')).toBeNull();
      expect(answer('1')).toBeNull();
      expect(answer('\r')).toBe('RUNNING');
      // The next approval reads numbers as answers again.
      expect(answer('3')).toBe('IDLE');
    });

    it('forgets an amend field once the terminal has left the approval', () => {
      const tracker = new TerminalInputStatusTracker();
      expect(
        statusAfter('\t', 'claude', 'WAITING_APPROVAL', CLAUDE_PERMISSION_DIALOG, tracker),
      ).toBeNull();
      expect(statusAfter('x', 'claude', 'THINKING', [], tracker)).toBeNull();
      expect(
        statusAfter('1', 'claude', 'WAITING_APPROVAL', CLAUDE_PERMISSION_DIALOG, tracker),
      ).toBe('RUNNING');
    });
  });
});
