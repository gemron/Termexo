import { formatRelativeTime } from './workspace-ui';

/** What an empty cell shows, so a table never has a hole in it. */
const ABSENT = '—';

/**
 * A wall-clock moment with the year.
 *
 * The audit log and the enrolment list both reach back further than a few days, where a date
 * without a year is ambiguous.
 */
export function formatMoment(value: number | null | undefined, locale: string): string {
  if (!value) {
    return ABSENT;
  }
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

/** "3 minutes ago" — how long a device has been up, or how long ago it was last seen. */
export function formatSince(value: number | null | undefined, locale: string): string {
  return value ? formatRelativeTime(value, locale) : ABSENT;
}

export function formatText(value: string | null | undefined): string {
  return value && value.trim() ? value : ABSENT;
}
