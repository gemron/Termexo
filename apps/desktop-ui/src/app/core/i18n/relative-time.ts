/** Units a past moment is described in, largest first; the first one it fills is the one used. */
const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
  ['second', 1_000],
];

/**
 * Describes a past moment as "3 minutes ago" in the active language.
 *
 * `Intl` carries the wording for every language the app offers, so this needs no translation
 * table of its own; `numeric: 'auto'` is what turns a fresh timestamp into "now" instead of
 * "0 seconds ago".
 */
export function formatRelativeTime(timestamp: number, locale: string, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  // A clock that is a little behind the backend's must not produce a moment in the future.
  const elapsed = Math.max(0, now - timestamp);
  for (const [unit, span] of UNITS) {
    if (elapsed >= span) {
      return format.format(-Math.floor(elapsed / span), unit);
    }
  }
  return format.format(0, 'second');
}
