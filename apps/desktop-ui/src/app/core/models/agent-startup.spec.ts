import { describe, expect, it } from 'vitest';

import { AGENT_STARTUP_CONFIRM_KEY, startupConfirmationWrites } from './agent-startup';

const CURSOR_UP = '\x1b[A';
const CURSOR_DOWN = '\x1b[B';

describe('startupConfirmationWrites', () => {
  it('moves the highlight up onto the trust option Claude preselects away from', () => {
    const frame = [
      'Do you trust the files in this folder?',
      'D:\devlop\Termexo',
      '  1. Yes, I trust this folder',
      '❯ 2. No, exit',
    ].join('\n');

    expect(startupConfirmationWrites(frame)).toEqual([CURSOR_UP, AGENT_STARTUP_CONFIRM_KEY]);
  });

  it('accepts a dialog that already highlights the option to proceed', () => {
    const frame = ['❯ 1. Yes, proceed', '  2. No, exit'].join('\n');

    expect(startupConfirmationWrites(frame)).toEqual([AGENT_STARTUP_CONFIRM_KEY]);
  });

  it('moves the highlight down when the declining option comes first', () => {
    const frame = [
      '› 1. No, ask me every time',
      '  2. Yes, allow Codex to work in this folder',
    ].join('\n');

    expect(startupConfirmationWrites(frame)).toEqual([CURSOR_DOWN, AGENT_STARTUP_CONFIRM_KEY]);
  });

  it('crosses over several options to reach the one that grants access', () => {
    const frame = ['❯ 1. No, exit', '  2. Not now', '  3. Yes, I trust this folder'].join('\n');

    expect(startupConfirmationWrites(frame)).toEqual([
      CURSOR_DOWN,
      CURSOR_DOWN,
      AGENT_STARTUP_CONFIRM_KEY,
    ]);
  });

  it('reads only the dialog on screen, not the one already answered', () => {
    const frame = [
      '  1. Yes, I trust this folder',
      '❯ 2. No, exit',
      'Which model should this session use?',
      '❯ 1. Keep the default',
      '  2. Yes, switch to Opus',
    ].join('\n');

    expect(startupConfirmationWrites(frame)).toEqual([CURSOR_DOWN, AGENT_STARTUP_CONFIRM_KEY]);
  });

  it('keeps the plain Enter for a picker whose options it cannot read', () => {
    const frame = ['› 1. Use the default setting', '  2. Change it'].join('\n');

    expect(startupConfirmationWrites(frame)).toEqual([AGENT_STARTUP_CONFIRM_KEY]);
  });

  it('keeps the plain Enter for a prompt with no option list at all', () => {
    expect(startupConfirmationWrites('Press Enter to continue')).toEqual([
      AGENT_STARTUP_CONFIRM_KEY,
    ]);
  });
});
