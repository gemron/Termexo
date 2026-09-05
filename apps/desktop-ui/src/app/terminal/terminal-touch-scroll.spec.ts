import { describe, expect, it } from 'vitest';

import { decayInertia, TerminalTouchScroller } from './terminal-touch-scroll';

const ROW_HEIGHT = 16;

function scroller(rowHeight = ROW_HEIGHT): TerminalTouchScroller {
  return new TerminalTouchScroller(() => rowHeight);
}

describe('TerminalTouchScroller', () => {
  it('ignores movement small enough to be a tap', () => {
    const touch = scroller();
    touch.begin(100, 0);

    expect(touch.drag(103, 16)).toBe(0);
    expect(touch.active).toBe(false);
  });

  it('scrolls towards older output when the finger drags downwards', () => {
    const touch = scroller();
    touch.begin(100, 0);
    touch.drag(110, 16);

    // Two further rows of travel, reported with xterm's sign convention for older output.
    expect(touch.drag(142, 32)).toBe(-2);
  });

  it('scrolls towards newer output when the finger drags upwards', () => {
    const touch = scroller();
    touch.begin(200, 0);
    touch.drag(190, 16);

    expect(touch.drag(158, 32)).toBe(2);
  });

  it('carries sub-row movement so a slow drag still advances', () => {
    const touch = scroller();
    touch.begin(100, 0);
    touch.drag(110, 16);

    // Ten pixels are already banked; six more complete the first whole row.
    expect(touch.drag(114, 32)).toBe(0);
    expect(touch.drag(120, 48)).toBe(-1);
  });

  it('reports no velocity when the gesture never became a scroll', () => {
    const touch = scroller();
    touch.begin(100, 0);
    touch.drag(102, 16);

    expect(touch.release(32)).toBe(0);
  });

  it('measures flick velocity from the recent samples', () => {
    const touch = scroller();
    touch.begin(0, 0);
    touch.drag(40, 20);
    touch.drag(80, 40);

    // 80 pixels over 40ms, in the positive direction the finger travelled.
    expect(touch.release(40)).toBeCloseTo(2, 5);
  });

  /**
   * A remote client draws the desktop's grid, so a phone has to pan sideways to read a long line.
   * Claiming a gesture that is mostly horizontal would swallow that pan, since the handler
   * suppresses the browser's own scrolling whenever it takes over.
   */
  it('declines a horizontal gesture so the browser can pan a wider grid', () => {
    const touch = scroller();
    touch.begin(100, 0, 200);

    // Mostly sideways, with the slight vertical drift any real finger produces.
    expect(touch.drag(103, 16, 240)).toBe(0);
    expect(touch.drag(106, 32, 300)).toBe(0);
    expect(touch.active).toBe(false);
  });

  it('keeps scrolling once a vertical gesture has been claimed, even if it drifts sideways', () => {
    const touch = scroller();
    touch.begin(100, 0, 200);
    touch.drag(120, 16, 202);

    // The gesture is already a scroll; sideways drift must not hand it back to the browser.
    expect(touch.drag(152, 32, 300)).toBe(-2);
    expect(touch.active).toBe(true);
  });

  it('claims a vertical gesture that drifts slightly sideways', () => {
    const touch = scroller();
    touch.begin(100, 0, 200);

    expect(touch.drag(116, 16, 203)).toBe(-1);
    expect(touch.active).toBe(true);
  });

  it('ends the drag but keeps the carried remainder for the glide that follows', () => {
    const touch = scroller();
    touch.begin(0, 0);
    touch.drag(20, 16);
    // Eight pixels of a row are banked and must not be lost when the finger lifts.
    touch.drag(28, 32);
    touch.release(32);

    expect(touch.active).toBe(false);
    // Half a row of glide completes the row that the drag left unfinished.
    expect(touch.glide(0.5, 16)).toBe(-1);
  });

  it('treats a row height of zero as unscrollable rather than dividing by it', () => {
    const touch = scroller(0);
    touch.begin(100, 0);
    touch.drag(110, 16);

    expect(touch.drag(200, 32)).toBe(0);
  });

  it('converts a glide step into rows', () => {
    const touch = scroller();
    touch.begin(0, 0);

    // 2px/ms across a 16ms frame is 32px, two rows of older output.
    expect(touch.glide(2, 16)).toBe(-2);
  });
});

describe('decayInertia', () => {
  it('slows a glide down over successive frames', () => {
    const first = decayInertia(2, 16);
    const second = decayInertia(first, 16);

    expect(first).toBeLessThan(2);
    expect(second).toBeLessThan(first);
  });

  it('stops once the glide is no longer visible', () => {
    expect(decayInertia(0.01, 16)).toBe(0);
  });

  it('decays by the same amount per unit of time regardless of frame rate', () => {
    const oneLongFrame = decayInertia(2, 32);
    const twoShortFrames = decayInertia(decayInertia(2, 16), 16);

    expect(oneLongFrame).toBeCloseTo(twoShortFrames, 6);
  });
});
