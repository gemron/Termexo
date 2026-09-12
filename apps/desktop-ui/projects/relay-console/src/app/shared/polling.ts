import { DestroyRef, inject } from '@angular/core';

/**
 * Repeats `tick` until the calling component is destroyed.
 *
 * Leaving a page has to stop its polling, or every page ever visited keeps asking the relay for
 * data nobody is looking at. Call it from a constructor, where an injection context exists.
 */
export function pollWhileAlive(intervalMs: number, tick: () => void): void {
  const destroyRef = inject(DestroyRef);
  const timer = setInterval(tick, intervalMs);
  destroyRef.onDestroy(() => clearInterval(timer));
}
