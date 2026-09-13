import type { AgentType, TerminalStatus } from '../core/models/workspace.models';
import { AGENT_INTERRUPT_SEQUENCE } from './terminal-key-sequences';

/**
 * The status a keystroke moves a terminal to, for the moments an agent reports nothing itself.
 *
 * Claude Code 2.1 and Codex CLI 0.154 raise no event when the user presses Esc to stop a turn or
 * turns down an approval, and an approval answered without Enter only surfaces once the tool has
 * finished running. Without reading the keys, the terminal would keep claiming the agent is busy or
 * waiting for approval long after it went back to its prompt. OpenCode and Antigravity report both
 * through their own events, so for them only a submitted prompt moves the status.
 */

/** What Enter sends, and so the mark of a submitted prompt or a confirmed choice. */
const SUBMIT_SEQUENCE = '\r';

/** Tab in an approval dialog opens Claude Code's field for amending the highlighted answer. */
const AMEND_SEQUENCE = '\t';

/** Agents whose interrupts and approval answers have to be read from the keyboard. */
const KEY_TRACKED_AGENTS: ReadonlySet<AgentType> = new Set<AgentType>(['claude', 'codex']);

/** The states Esc interrupts: a turn in progress, or the approval dialog the turn stopped at. */
const INTERRUPTIBLE_STATUSES: ReadonlySet<TerminalStatus> = new Set<TerminalStatus>([
  'THINKING',
  'RUNNING',
  'WAITING_APPROVAL',
]);

/**
 * One numbered row of a choice dialog: an optional highlight pointer, the number and the label.
 *
 * Claude Code points with `>` on Windows (`❯` elsewhere) and Codex CLI with `›`. Box borders are
 * tolerated so a dialog drawn inside a frame still reads the same.
 */
const OPTION_ROW = /^[\s│]*([>❯›])?\s*(\d)\.\s+(\S.*?)[\s│]*$/;

/** Both agents start every approving label with "Yes" and every refusing one with "No". */
const APPROVING_LABEL = /^Yes\b/;
const REFUSING_LABEL = /^No\b/;

/** A one-key shortcut printed at the end of a row, the way Codex CLI marks `(y)` and `(p)`. */
const TRAILING_SHORTCUT = /\((\S)\)[\s│]*$/;

/**
 * How many rows a label may wrap onto before the numbers above are taken to be unrelated output.
 *
 * Claude Code's "always allow access to <path>" wraps once at ordinary widths; the headroom covers
 * a long command in a narrow terminal.
 */
const MAX_OPTION_CONTINUATION_ROWS = 4;

/** An option of the choice dialog on screen. */
export interface ApprovalOption {
  readonly number: number;
  /** True for an option that approves, false for one that refuses, null for any other answer. */
  readonly approves: boolean | null;
  /** Whether the dialog's pointer is on this option, which is what Enter confirms. */
  readonly selected: boolean;
  /** The single key the dialog says picks this option, if it names one. */
  readonly shortcut: string | null;
}

/** What the tracker needs to know about the terminal a keystroke was typed into. */
export interface TerminalInputContext {
  readonly agentType: AgentType;
  readonly status: TerminalStatus;
  /** Reads the dialog on screen; only called for a key that could answer an approval. */
  readonly readApprovalOptions: () => readonly ApprovalOption[];
}

/** Whether the input submits what was typed or confirms a choice. */
export function isSubmission(data: string): boolean {
  return data.includes(SUBMIT_SEQUENCE);
}

/**
 * Reads the choice dialog at the bottom of the screen.
 *
 * Both agents draw it as the last numbered list on screen, so the scan runs upwards from the bottom
 * and stops at option 1. A list whose numbers do not count down without gaps is not a dialog, and
 * reads as none.
 */
export function readApprovalOptions(rows: readonly string[]): ApprovalOption[] {
  const options: ApprovalOption[] = [];
  // Rows between an option and the one below it are its label, wrapped.
  let labelContinuation: string[] = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const match = OPTION_ROW.exec(rows[index]);
    const number = match ? Number(match[2]) : Number.NaN;
    const expected = options.length === 0 ? number : options[options.length - 1].number - 1;
    if (match && number === expected) {
      options.push(toApprovalOption(match, [rows[index], ...labelContinuation]));
      if (number === 1) {
        return options.reverse();
      }
      labelContinuation = [];
      continue;
    }
    if (options.length === 0) {
      continue;
    }
    labelContinuation.push(rows[index]);
    if (labelContinuation.length > MAX_OPTION_CONTINUATION_ROWS) {
      break;
    }
  }
  return [];
}

function toApprovalOption(match: RegExpExecArray, labelRows: readonly string[]): ApprovalOption {
  const label = match[3];
  return {
    number: Number(match[2]),
    approves: APPROVING_LABEL.test(label) ? true : REFUSING_LABEL.test(label) ? false : null,
    selected: match[1] !== undefined,
    shortcut: labelRows.map((row) => TRAILING_SHORTCUT.exec(row)?.[1]).find(Boolean) ?? null,
  };
}

function submittedStatus(agentType: AgentType): TerminalStatus {
  return agentType === 'shell' ? 'RUNNING' : 'THINKING';
}

function statusForAnswer(option: ApprovalOption): TerminalStatus | null {
  if (option.approves === null) {
    return null;
  }
  return option.approves ? 'RUNNING' : 'IDLE';
}

/**
 * Turns keystrokes into status changes, one terminal at a time.
 *
 * Kept per terminal because one answer spans several keystrokes: after Tab opens the amend field,
 * the digits that follow are typed text rather than a choice.
 */
export class TerminalInputStatusTracker {
  private amendingApproval = false;

  /** The status the input moves the terminal to, or null when it implies no change. */
  statusAfterInput(data: string, context: TerminalInputContext): TerminalStatus | null {
    const status = this.resolveStatus(data, context);
    if (status !== null || context.status !== 'WAITING_APPROVAL') {
      this.amendingApproval = false;
    }
    return status;
  }

  private resolveStatus(data: string, context: TerminalInputContext): TerminalStatus | null {
    const { agentType, status } = context;
    if (!KEY_TRACKED_AGENTS.has(agentType)) {
      return isSubmission(data) ? submittedStatus(agentType) : null;
    }
    // Only a lone Escape: an arrow key or an Alt chord starts with the same byte.
    if (data === AGENT_INTERRUPT_SEQUENCE) {
      return INTERRUPTIBLE_STATUSES.has(status) ? 'IDLE' : null;
    }
    if (status !== 'WAITING_APPROVAL') {
      return isSubmission(data) ? submittedStatus(agentType) : null;
    }
    return this.approvalAnswerStatus(data, context);
  }

  /**
   * The status an answer to the approval dialog leads to.
   *
   * Anything the dialog does not say it accepts leaves the status alone, so arrows, pasted text and
   * keys of a dialog that is no longer on screen cannot move it.
   */
  private approvalAnswerStatus(data: string, context: TerminalInputContext): TerminalStatus | null {
    if (isSubmission(data)) {
      // Enter confirms the highlighted option; only a highlighted refusal leaves the tool unrun.
      const selected = context.readApprovalOptions().find((option) => option.selected);
      return selected?.approves === false ? 'IDLE' : 'RUNNING';
    }
    if (data === AMEND_SEQUENCE) {
      this.amendingApproval = true;
      return null;
    }
    if (this.amendingApproval || data.length !== 1) {
      return null;
    }
    // Both dialogs confirm an option as soon as its number is typed (Claude Code ran the tool on `1`
    // without Enter); Codex CLI also takes the letter it prints after each option.
    const answered = context
      .readApprovalOptions()
      .find((option) => String(option.number) === data || option.shortcut === data);
    return answered ? statusForAnswer(answered) : null;
  }
}
