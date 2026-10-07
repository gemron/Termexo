import {
  AGENT_INTERRUPT_SEQUENCE,
  REVERSE_TAB_SEQUENCE,
  cursorKeySequences,
  type CursorDirection,
  type QuickKey,
} from './terminal-key-sequences';

/** Every keypad key whose sequence does not depend on the terminal's modes. */
const FIXED_QUICK_KEY_SEQUENCES: Readonly<
  Record<Exclude<QuickKey, CursorDirection | 'shiftLeft'>, string>
> = {
  escape: AGENT_INTERRUPT_SEQUENCE,
  tab: '\t',
  shiftTab: REVERSE_TAB_SEQUENCE,
  enter: '\r',
  // End of text: cancellation or exit depends on the CLI and its current state.
  ctrlC: '\x03',
  ctrlO: '\x0f',
  ctrlR: '\x12',
  ctrlT: '\x14',
  ctrlP: '\x10',
  ctrlL: '\x0c',
  ctrlJ: '\n',
  // OpenCode's default leader followed by M; no Enter or command text is inserted.
  ctrlXThenM: '\x18m',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  home: '\x1b[H',
  end: '\x1b[F',
};

function isCursorDirection(key: QuickKey): key is CursorDirection {
  return key in cursorKeySequences(false);
}

/** The bytes a keypad key writes, matching what the same key on a real keyboard would send. */
export function quickKeySequence(key: QuickKey, applicationCursorKeys: boolean): string {
  // A modifier turns this into CSI even while application cursor keys are enabled.
  if (key === 'shiftLeft') return '\x1b[1;2D';
  return isCursorDirection(key)
    ? cursorKeySequences(applicationCursorKeys)[key]
    : FIXED_QUICK_KEY_SEQUENCES[key];
}
