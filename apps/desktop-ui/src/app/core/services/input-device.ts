/** Matches a device driven mainly by a finger, whose keyboard is on screen rather than in hand. */
const TOUCH_PRIMARY_POINTER_QUERY = '(pointer: coarse)';

/**
 * Whether the main pointer is a finger.
 *
 * Such a device has no Esc or arrow keys, and focusing a text field raises a keyboard that covers
 * or resizes the page — both of which the UI has to plan for. False where media queries are not
 * available, as in unit tests.
 */
export function primaryPointerIsTouch(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(TOUCH_PRIMARY_POINTER_QUERY).matches
  );
}
