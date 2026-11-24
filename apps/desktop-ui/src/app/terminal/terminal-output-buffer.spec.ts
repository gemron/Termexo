import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalOutputBuffer } from './terminal-output-buffer';

describe('remote terminal output frames', () => {
  let buffer: TerminalOutputBuffer;
  const write = vi.fn<(data: string, replayed: boolean) => void>();
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;

  const paint = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    write.mockReset();
    buffer = new TerminalOutputBuffer(write);
  });
  afterEach(() => {
    buffer.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('paints a burst containing clear and redraw as one ordered write', () => {
    buffer.enqueue('\x1b[2J', false);
    buffer.enqueue('\x1b[H', false);
    buffer.enqueue('AI answer\r\n', false);
    expect(write).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    paint();
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[2J\x1b[HAI answer\r\n', false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the old screen until the replacement arrives in a later remote frame', () => {
    buffer.enqueue('\x1b[H\x1b[2J', false);
    paint();
    vi.advanceTimersByTime(80);
    buffer.enqueue('\x1b[?25l\x1b[', false);
    paint();
    vi.advanceTimersByTime(40);
    expect(write).not.toHaveBeenCalled();

    buffer.enqueue('1mAI answer', false);
    paint();
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[H\x1b[2J\x1b[?25l\x1b[1mAI answer', false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recognises a clear command split across writes without delaying preceding text', () => {
    buffer.enqueue('prompt\x1b[2', false);
    paint();
    expect(write).toHaveBeenCalledExactlyOnceWith('prompt\x1b[2', false);

    buffer.enqueue('J\x1b[H', false);
    paint();
    expect(write).toHaveBeenCalledTimes(1);
    buffer.enqueue('new screen', false);
    paint();
    expect(write).toHaveBeenLastCalledWith('J\x1b[Hnew screen', false);
  });

  it('executes a standalone clear at the deadline even if cursor updates keep arriving', () => {
    buffer.enqueue('\x9b2J', false);
    paint();
    vi.advanceTimersByTime(100);
    buffer.enqueue('\x1b[H', false);
    paint();
    vi.advanceTimersByTime(99);
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledExactlyOnceWith('\x9b2J\x1b[H', false);
    expect(vi.getTimerCount()).toBe(0);
    buffer.enqueue('>', false);
    paint();
    expect(write).toHaveBeenLastCalledWith('>', false);
  });

  it('keeps a pending live clear ahead of a replay and subsequent live output', () => {
    buffer.enqueue('\x1b[2J', false);
    paint();
    expect(write).not.toHaveBeenCalled();

    buffer.enqueue('history', true);
    buffer.enqueue('live', false);
    paint();
    expect(write.mock.calls).toEqual([
      ['\x1b[2J', false],
      ['history', true],
      ['live', false],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves split ANSI sequences, native synchronized frames, and unicode exactly', () => {
    const packets = ['\x1b[?202', '6h\x1b[2', 'J\x1b[H中', '文 😀\x1b[?2026l'];
    packets.forEach((data) => buffer.enqueue(data, false));
    paint();
    expect(write).toHaveBeenCalledExactlyOnceWith(packets.join(''), false);
  });

  it('keeps replay and live output boundaries so only history suppresses terminal replies', () => {
    buffer.enqueue('live before', false);
    buffer.enqueue('clear+history', true);
    buffer.enqueue('more history', true);
    buffer.enqueue('live after', false);
    paint();
    expect(write.mock.calls).toEqual([
      ['live before', false],
      ['clear+historymore history', true],
      ['live after', false],
    ]);
  });

  it('continues parsing when a hidden tab stops receiving animation frames', async () => {
    buffer.enqueue('background output', false);
    await vi.advanceTimersByTimeAsync(31);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledExactlyOnceWith('background output', false);
    expect(frames.size).toBe(0);
  });

  it('bounds the pending batch without dropping a fast output stream', () => {
    const data = 'x'.repeat(128 * 1024);
    buffer.enqueue(data, false);
    expect(write).toHaveBeenCalledExactlyOnceWith(data, false);
    expect(frames.size).toBe(0);
    buffer.enqueue('tail', false);
    paint();
    expect(write.mock.calls.map(([data]) => data).join('')).toBe(data + 'tail');
  });

  it('does not write to a terminal closed before its scheduled frame', () => {
    buffer.enqueue('late output', false);
    const lateFrame = [...frames.values()][0];
    buffer.dispose();
    lateFrame(0);
    buffer.enqueue('after close', true);
    expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps output queued during a flush for the following frame', () => {
    write.mockImplementationOnce(() => buffer.enqueue('next frame', false));
    buffer.enqueue('first frame', false);
    paint();
    expect(write.mock.calls).toEqual([['first frame', false]]);
    paint();
    expect(write.mock.calls).toEqual([
      ['first frame', false],
      ['next frame', false],
    ]);
  });
});
