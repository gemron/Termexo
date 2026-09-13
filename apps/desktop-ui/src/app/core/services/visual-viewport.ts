/**
 * Sizes the page to the part of the screen an on-screen keyboard leaves visible.
 *
 * A mobile browser raises its keyboard over the page instead of shrinking it — iOS always, and
 * Android unless the viewport meta opts into `interactive-widget=resizes-content`, which Safari
 * ignores. The agent's input line sits at the bottom of the terminal, so it disappeared under the
 * keyboard at exactly the moment the user started typing. Following the visual viewport shrinks
 * the page instead: the terminal refits to the rows that are left and the agent redraws its input
 * line above the keyboard.
 */

/** Height the root styles give the page; unset, the page keeps its full height. */
export const VISUAL_VIEWPORT_HEIGHT_PROPERTY = '--visual-viewport-height';
/** How far the browser has panned the page to reveal a focused field. */
export const VISUAL_VIEWPORT_OFFSET_PROPERTY = '--visual-viewport-offset';
/** Marks the root while tracking runs, so the pan is only followed where it is measured. */
export const VISUAL_VIEWPORT_TRACKED_ATTRIBUTE = 'data-visual-viewport';

/** Below this departure from 1 the page counts as unzoomed, whatever rounding `scale` carries. */
const ZOOM_TOLERANCE = 0.01;

/** The part of `window.visualViewport` this reads, so tests can stand in for it. */
export interface VisualViewportLike extends EventTarget {
  readonly height: number;
  readonly offsetTop: number;
  readonly scale: number;
}

const VIEWPORT_EVENTS = ['resize', 'scroll'] as const;

/** Starts following the visual viewport and returns the function that stops it. */
export function trackVisualViewport(
  root: HTMLElement,
  viewport: VisualViewportLike | null = window.visualViewport,
): () => void {
  if (!viewport) {
    return () => undefined;
  }

  const apply = (): void => {
    const zoomed = Math.abs(viewport.scale - 1) > ZOOM_TOLERANCE;
    // Scaled back up, so pinch-zooming leaves the page its size and only the keyboard shrinks it.
    const height = Math.round(viewport.height * viewport.scale);
    // iOS pans the page up to reveal the focused field. Following that pan keeps the page lined up
    // with what is on screen; while zoomed the pan is the user's own, and following it would move
    // the content away from wherever they scroll to.
    const offset = zoomed ? 0 : Math.round(viewport.offsetTop);
    root.style.setProperty(VISUAL_VIEWPORT_HEIGHT_PROPERTY, `${height}px`);
    root.style.setProperty(VISUAL_VIEWPORT_OFFSET_PROPERTY, `${offset}px`);
  };

  root.setAttribute(VISUAL_VIEWPORT_TRACKED_ATTRIBUTE, '');
  apply();
  for (const type of VIEWPORT_EVENTS) {
    viewport.addEventListener(type, apply);
  }

  return () => {
    for (const type of VIEWPORT_EVENTS) {
      viewport.removeEventListener(type, apply);
    }
    root.removeAttribute(VISUAL_VIEWPORT_TRACKED_ATTRIBUTE);
    root.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_PROPERTY);
    root.style.removeProperty(VISUAL_VIEWPORT_OFFSET_PROPERTY);
  };
}
