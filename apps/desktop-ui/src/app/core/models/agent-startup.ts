import { stripTerminalControl } from './terminal-output';

/**
 * How long the terminal must stay silent before its current frame counts as settled. Both CLIs
 * animate while they boot, so a window this long is only reached once they are waiting on input.
 */
export const AGENT_STARTUP_QUIET_MS = 1_500;
/** Upper bound on waiting for a settled frame; afterwards the prompt is delivered anyway. */
export const AGENT_STARTUP_TIMEOUT_MS = 60_000;
/**
 * How long after the PTY starts a settled frame alone is not accepted as "ready for input".
 *
 * The shell echoes its command and the Windows npm shim prints before Node has even booted, and
 * both are followed by seconds of silence while the CLI loads. That first silence looks exactly
 * like an agent waiting on input, so without this floor the prompt is written into a process that
 * is not reading stdin yet and is lost. A recognised ready marker still submits immediately.
 */
export const AGENT_STARTUP_SETTLE_FLOOR_MS = 6_000;
/** Startup dialogs are few — more answers than this would mean the matcher is misfiring. */
export const AGENT_STARTUP_MAX_CONFIRMATIONS = 3;
/** Only the latest frame is matched; older scrollback would keep re-matching stale dialogs. */
export const AGENT_STARTUP_TAIL_LIMIT = 4_000;
/** Enter, which accepts whichever option the dialog currently highlights. */
export const AGENT_STARTUP_CONFIRM_KEY = '\r';
/** Arrow keys, used to move the highlight onto the option that lets the agent proceed. */
const CURSOR_UP_KEY = '\x1b[A';
const CURSOR_DOWN_KEY = '\x1b[B';

/**
 * Wording of the startup gates Claude Code and Codex CLI show before accepting a prompt. The
 * Claude phrases are the labels of its current folder-trust screen; the older wording is kept so
 * installations that have not updated are still recognised.
 */
const CONFIRMATION_PHRASES: readonly RegExp[] = [
  /yes,\s*i trust this folder/i,
  /quick safety check/i,
  /read,\s*edit,\s*and execute files here/i,
  /do you trust the files in this folder/i,
  /yes,\s*proceed/i,
  /allow codex to work in this folder/i,
  /trust(?:ed)?\s+(?:this\s+)?(?:folder|directory|workspace)/i,
  /press\s+enter\s+to\s+continue/i,
];
/** A numbered choice list with one option highlighted is a dialog waiting on a keypress. */
const HIGHLIGHTED_CHOICE = /[❯›▸>]\s*\d\.\s/;
const CHOICE_LIST = /\b1\.\s[\s\S]{0,400}?\b2\.\s/;
/** One option of a startup dialog, as in `❯ 1. Yes, I trust this folder`. */
const CHOICE_LINE = /^\s*([❯›▸▶>])?\s*(\d+)[.)]\s+(\S.*?)\s*$/;
/** Wording of the option that lets the agent work in the folder. */
const AFFIRMATIVE_CHOICE = /\byes\b|\ballow\b|\bproceed\b|\bcontinue\b|trust|信任|允许|继续|同意/i;
/** A declining option names the same subject ("No, I don't trust this folder"), so it is ruled out
 * before the affirmative wording is looked for. */
const DECLINING_CHOICE = /\bno\b|\bnot\b|don'?t|exit|quit|cancel|拒绝|退出|取消|不/i;

/**
 * Marks of an agent whose own input is live.
 *
 * Both CLIs draw a boxed composer with a shortcut hint once they accept typing, and neither
 * paints it until the session is up. Matching one is positive evidence — unlike silence, which a
 * CLI that is still loading produces just as readily.
 */
const READY_PHRASES: readonly RegExp[] = [
  /\?\s*for shortcuts/i,
  /esc\s+to\s+interrupt/i,
  /ctrl\s*\+?\s*c\s+to\s+(?:quit|exit)/i,
  /╰[─━]{4,}╯/,
];

/** One parsed option of a startup dialog. */
interface StartupChoice {
  /** True for the option the dialog has preselected. */
  highlighted: boolean;
  /** True for an option that grants the agent access rather than declining it. */
  affirmative: boolean;
}

export function normalizeStartupFrame(previousFrame: string, data: string): string {
  return stripTerminalControl(`${previousFrame}${data}`).slice(-AGENT_STARTUP_TAIL_LIMIT);
}

/** True when a settled frame is a confirmation dialog rather than a prompt ready for input. */
export function isStartupConfirmation(frame: string): boolean {
  return (
    CONFIRMATION_PHRASES.some((phrase) => phrase.test(frame)) ||
    (HIGHLIGHTED_CHOICE.test(frame) && CHOICE_LIST.test(frame))
  );
}

/** True when the frame shows the agent's composer, meaning a prompt written now is read. */
export function isAgentReadyForPrompt(frame: string): boolean {
  return !isStartupConfirmation(frame) && READY_PHRASES.some((phrase) => phrase.test(frame));
}

/**
 * The ordered key writes that answer the startup dialog on screen.
 *
 * Claude Code's folder-trust screen preselects "No, exit", so accepting the highlighted option
 * would close the agent instead of starting the task. When the dialog names an option that grants
 * access, the highlight is moved onto it first; a dialog whose wording is unknown keeps the plain
 * Enter, which is what a user pressing through the preselected answer would do.
 *
 * Each key is a separate write because both CLIs read one PTY chunk as one keystroke — see
 * {@link ./terminal-input}.
 */
export function startupConfirmationWrites(frame: string): string[] {
  const choices = parseStartupChoices(frame);
  const highlighted = choices.findIndex((choice) => choice.highlighted);
  const target = choices.findIndex((choice) => choice.affirmative);
  if (highlighted < 0 || target < 0) return [AGENT_STARTUP_CONFIRM_KEY];
  const stepKey = target > highlighted ? CURSOR_DOWN_KEY : CURSOR_UP_KEY;
  const moves = Array.from({ length: Math.abs(target - highlighted) }, () => stepKey);
  return [...moves, AGENT_STARTUP_CONFIRM_KEY];
}

/**
 * Reads the option list out of a settled frame.
 *
 * Only the last list survives: a dialog that was already answered stays in the scrollback, and its
 * options would otherwise be counted alongside the ones now on screen.
 */
function parseStartupChoices(frame: string): StartupChoice[] {
  const choices: StartupChoice[] = [];
  for (const line of frame.split('\n')) {
    const match = CHOICE_LINE.exec(line);
    if (!match) continue;
    const [, marker, ordinal, label] = match;
    const position = Number(ordinal);
    // A list restarts at 1; a number out of order belongs to neither list and is ignored.
    if (position === 1) choices.length = 0;
    else if (position !== choices.length + 1) continue;
    choices.push({
      highlighted: marker !== undefined,
      affirmative: !DECLINING_CHOICE.test(label) && AFFIRMATIVE_CHOICE.test(label),
    });
  }
  return choices;
}
