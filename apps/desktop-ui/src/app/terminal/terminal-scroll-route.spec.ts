import { describe, expect, it } from 'vitest';

import {
  cursorScrollSequence,
  ScrollRowAccumulator,
  terminalScrollRoute,
  wheelScrollRows,
} from './terminal-scroll-route';

const DELTA_MODE_PIXEL = 0;
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

describe('terminalScrollRoute', () => {
  it('reports the wheel to an agent that tracks the mouse', () => {
    expect(terminalScrollRoute('any', 'alternate')).toBe('mouseReport');
    expect(terminalScrollRoute('drag', 'normal')).toBe('mouseReport');
    expect(terminalScrollRoute('vt200', 'normal')).toBe('mouseReport');
  });

  it('leaves x10 to the buffer, since that protocol carries no wheel', () => {
    expect(terminalScrollRoute('x10', 'alternate')).toBe('cursorKeys');
    expect(terminalScrollRoute('x10', 'normal')).toBe('viewport');
  });

  it('sends cursor keys to a full-screen agent, which has no scrollback to move', () => {
    expect(terminalScrollRoute('none', 'alternate')).toBe('cursorKeys');
  });

  it('scrolls xterm itself for an ordinary program', () => {
    expect(terminalScrollRoute('none', 'normal')).toBe('viewport');
  });
});

describe('cursorScrollSequence', () => {
  it('sends one up arrow per row towards older output', () => {
    expect(cursorScrollSequence(-3, false)).toBe('\x1b[A\x1b[A\x1b[A');
  });

  it('sends one down arrow per row towards newer output', () => {
    expect(cursorScrollSequence(2, false)).toBe('\x1b[B\x1b[B');
  });

  it('uses the application form while DECCKM is set', () => {
    expect(cursorScrollSequence(-1, true)).toBe('\x1bOA');
    expect(cursorScrollSequence(1, true)).toBe('\x1bOB');
  });

  it('sends nothing when the drag has not covered a row', () => {
    expect(cursorScrollSequence(0, false)).toBe('');
  });
});

describe('wheelScrollRows', () => {
  it('turns one notch of a pixel-reporting wheel into three rows', () => {
    expect(wheelScrollRows({ deltaY: 100, deltaMode: DELTA_MODE_PIXEL }, 24)).toBe(3);
    expect(wheelScrollRows({ deltaY: -100, deltaMode: DELTA_MODE_PIXEL }, 24)).toBe(-3);
  });

  it('turns one notch of a line-reporting wheel into three rows', () => {
    expect(wheelScrollRows({ deltaY: 3, deltaMode: DELTA_MODE_LINE }, 24)).toBe(3);
  });

  it('reads a page as the terminal own height', () => {
    expect(wheelScrollRows({ deltaY: 1, deltaMode: DELTA_MODE_PAGE }, 24)).toBe(24);
  });

  it('keeps a high-resolution wheel fraction of a row', () => {
    expect(wheelScrollRows({ deltaY: 10, deltaMode: DELTA_MODE_PIXEL }, 24)).toBeCloseTo(0.3);
  });
});

describe('ScrollRowAccumulator', () => {
  it('reports whole rows only once the fractions add up to one', () => {
    const rows = new ScrollRowAccumulator();

    expect(rows.take(0.3)).toBe(0);
    expect(rows.take(0.3)).toBe(0);
    expect(rows.take(0.3)).toBe(0);
    expect(rows.take(0.3)).toBe(1);
  });

  it('carries the remainder rather than dropping it', () => {
    const rows = new ScrollRowAccumulator();

    expect(rows.take(1.5)).toBe(1);
    expect(rows.take(0.5)).toBe(1);
  });

  it('forgets the remainder once reset', () => {
    const rows = new ScrollRowAccumulator();
    rows.take(0.9);
    rows.reset();

    expect(rows.take(0.9)).toBe(0);
  });

  it('ignores a row count that is not a number', () => {
    const rows = new ScrollRowAccumulator();

    expect(rows.take(Number.NaN)).toBe(0);
    expect(rows.take(1)).toBe(1);
  });
});
