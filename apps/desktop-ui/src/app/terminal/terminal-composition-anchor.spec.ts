import { TerminalCaretPosition, TerminalCompositionAnchor } from './terminal-composition-anchor';

describe('TerminalCompositionAnchor', () => {
  let host: HTMLDivElement;
  let textarea: HTMLTextAreaElement;
  let compositionView: HTMLDivElement;
  let caret: TerminalCaretPosition;
  let anchor: TerminalCompositionAnchor;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    const screen = document.createElement('div');
    screen.className = 'xterm-screen';
    Object.defineProperty(screen, 'clientWidth', { value: 800 });
    Object.defineProperty(screen, 'clientHeight', { value: 480 });

    textarea = document.createElement('textarea');
    textarea.className = 'xterm-helper-textarea';
    compositionView = document.createElement('div');
    compositionView.className = 'composition-view';
    screen.append(textarea, compositionView);
    host.append(screen);

    caret = { cols: 80, rows: 24, cursorX: 12, cursorY: 8 };
    anchor = new TerminalCompositionAnchor(host, () => caret);
  });

  afterEach(() => {
    anchor.end();
    vi.useRealTimers();
  });

  it('moves an off-screen helper textarea to the current caret before composition starts', () => {
    textarea.getBoundingClientRect = () => ({ left: -10_000 }) as DOMRect;

    anchor.prepare();

    expect(textarea.style.left).toBe('120px');
    expect(textarea.style.top).toBe('160px');
    expect(textarea.style.width).toBe('10px');
    expect(textarea.style.height).toBe('20px');
  });

  it('refreshes an on-screen textarea left at an earlier prompt position', () => {
    textarea.getBoundingClientRect = () => ({ left: 450 }) as DOMRect;
    textarea.style.left = '450px';
    textarea.style.top = '400px';

    anchor.prepare();

    expect(textarea.style.left).toBe('120px');
    expect(textarea.style.top).toBe('160px');
  });

  it('keeps the textarea and composition view at the starting caret while output moves the cursor', () => {
    anchor.begin();
    caret = { ...caret, cursorX: 45, cursorY: 20 };
    textarea.style.left = '450px';
    textarea.style.top = '400px';
    compositionView.style.left = '450px';
    compositionView.style.top = '400px';

    anchor.restore();

    expect(textarea.style.left).toBe('120px');
    expect(textarea.style.top).toBe('160px');
    expect(compositionView.style.left).toBe('120px');
    expect(compositionView.style.top).toBe('160px');
  });

  it('wins after xterm repeats its positioning in a zero-delay timer', () => {
    anchor.begin();
    caret = { ...caret, cursorX: 45, cursorY: 20 };

    // xterm schedules this before the host's composition/render listener runs.
    setTimeout(() => {
      textarea.style.left = '450px';
      textarea.style.top = '400px';
      compositionView.style.left = '450px';
      compositionView.style.top = '400px';
    }, 0);
    anchor.restoreAfterBrowserUpdate();
    vi.runAllTimers();

    expect(textarea.style.left).toBe('120px');
    expect(textarea.style.top).toBe('160px');
    expect(compositionView.style.left).toBe('120px');
    expect(compositionView.style.top).toBe('160px');
  });

  it('does not restore a delayed position after composition leaves the terminal', () => {
    anchor.begin();
    anchor.restoreAfterBrowserUpdate();
    anchor.end();
    textarea.style.left = '450px';

    vi.runAllTimers();

    expect(textarea.style.left).toBe('450px');
  });

  it('stops restoring the captured position when the composition ends', () => {
    anchor.begin();
    anchor.end();
    textarea.style.left = '450px';

    anchor.restore();

    expect(textarea.style.left).toBe('450px');
  });

  it('clamps the caret to the visible terminal cells', () => {
    caret = { cols: 80, rows: 24, cursorX: 80, cursorY: 24 };

    anchor.begin();

    expect(textarea.style.left).toBe('790px');
    expect(textarea.style.top).toBe('460px');
  });
});
