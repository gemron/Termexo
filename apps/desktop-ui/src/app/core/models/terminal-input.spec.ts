import { describe, expect, it } from 'vitest';

import { TerminalPromptCapture } from './prompt-assets';
import {
  TERMINAL_CLEAR_INPUT_KEY,
  TERMINAL_SUBMIT_KEY,
  bracketedPaste,
  terminalPromptWrites,
} from './terminal-input';

describe('terminalPromptWrites', () => {
  it('keeps the clear key, the paste and the submit in separate writes', () => {
    const writes = terminalPromptWrites('first\nsecond', true);

    expect(writes).toEqual([
      TERMINAL_CLEAR_INPUT_KEY,
      bracketedPaste('first\nsecond'),
      TERMINAL_SUBMIT_KEY,
    ]);
    expect(writes.filter((write) => write.includes(TERMINAL_SUBMIT_KEY))).toEqual([
      TERMINAL_SUBMIT_KEY,
    ]);
  });

  it('omits the submit when the prompt is only being restored into the input', () => {
    const writes = terminalPromptWrites('draft', false);

    expect(writes).toEqual([TERMINAL_CLEAR_INPUT_KEY, bracketedPaste('draft')]);
  });

  it('delivers a multi-line prompt as the single submission an agent input replays', () => {
    const prompt = 'task\n\nsecond line';
    const capture = new TerminalPromptCapture();

    let result = capture.consume('leftover');
    for (const write of terminalPromptWrites(prompt, true)) {
      result = capture.consume(write);
    }

    expect(result.submitted).toEqual([prompt]);
    expect(result.draft).toBe('');
  });

  it('normalizes line endings and drops control characters the input cannot represent', () => {
    expect(bracketedPaste('lineone\r\nline two')).toBe(bracketedPaste('lineone\nline two'));
    expect(bracketedPaste(`kept${TERMINAL_CLEAR_INPUT_KEY}text`)).toContain('kepttext');
  });
});
