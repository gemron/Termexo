import {
  trackVisualViewport,
  VISUAL_VIEWPORT_HEIGHT_PROPERTY,
  VISUAL_VIEWPORT_OFFSET_PROPERTY,
  VISUAL_VIEWPORT_TRACKED_ATTRIBUTE,
  VisualViewportLike,
} from './visual-viewport';

class FakeViewport extends EventTarget implements VisualViewportLike {
  height = 800;
  offsetTop = 0;
  scale = 1;

  change(values: Partial<Pick<FakeViewport, 'height' | 'offsetTop' | 'scale'>>, type: string) {
    Object.assign(this, values);
    this.dispatchEvent(new Event(type));
  }
}

describe('trackVisualViewport', () => {
  let root: HTMLElement;
  let viewport: FakeViewport;

  beforeEach(() => {
    root = document.createElement('div');
    viewport = new FakeViewport();
  });

  const height = () => root.style.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_PROPERTY);
  const offset = () => root.style.getPropertyValue(VISUAL_VIEWPORT_OFFSET_PROPERTY);

  it('sizes the page to the viewport as soon as tracking starts', () => {
    trackVisualViewport(root, viewport);

    expect(height()).toBe('800px');
    expect(offset()).toBe('0px');
    expect(root.hasAttribute(VISUAL_VIEWPORT_TRACKED_ATTRIBUTE)).toBe(true);
  });

  it('shrinks the page when the on-screen keyboard takes the bottom of the screen', () => {
    trackVisualViewport(root, viewport);

    viewport.change({ height: 460 }, 'resize');

    expect(height()).toBe('460px');
  });

  it('follows the pan the browser applies to reveal a focused field', () => {
    trackVisualViewport(root, viewport);

    viewport.change({ height: 460, offsetTop: 120 }, 'scroll');

    expect(offset()).toBe('120px');
  });

  it('keeps the full height and ignores the pan while the user is pinch-zoomed', () => {
    trackVisualViewport(root, viewport);

    viewport.change({ height: 400, offsetTop: 250, scale: 2 }, 'resize');

    expect(height()).toBe('800px');
    expect(offset()).toBe('0px');
  });

  it('restores the page when tracking stops', () => {
    const stop = trackVisualViewport(root, viewport);

    stop();
    viewport.change({ height: 300 }, 'resize');

    expect(height()).toBe('');
    expect(offset()).toBe('');
    expect(root.hasAttribute(VISUAL_VIEWPORT_TRACKED_ATTRIBUTE)).toBe(false);
  });

  it('does nothing in a browser without a visual viewport', () => {
    const stop = trackVisualViewport(root, null);

    expect(height()).toBe('');
    expect(() => stop()).not.toThrow();
  });
});
