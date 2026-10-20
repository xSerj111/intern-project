const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/**
 * Compact relative time for feeds and lists: `now`, `5m`, `3h`, `2d`, then
 * `Mar 4` (same year) or `Mar 4, 2024`.
 */
export function formatRelative(
  value: string | Date,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  const diff = now.getTime() - date.getTime();

  if (diff < 45_000) return 'now';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/** Full date and time for tooltips: `Oct 19, 2026, 2:03 PM`. */
export function formatFullDate(value: string | Date): string {
  return toDate(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Clock time for chat bubbles: `2:03 PM`. */
export function formatClock(value: string | Date): string {
  return toDate(value).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Day separator label for message threads: `Today`, `Yesterday`, a weekday
 * within the last week, else `Mon, Oct 3` (plus year if not this year).
 */
export function formatDayLabel(
  value: string | Date,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/** True when both dates fall on the same calendar day (local time). */
export function isSameDay(a: string | Date, b: string | Date): boolean {
  return startOfDay(toDate(a)) === startOfDay(toDate(b));
}

export type TimeBucket = 'today' | 'week' | 'month' | 'earlier';

export const TIME_BUCKET_LABELS: Record<TimeBucket, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  earlier: 'Earlier',
};

/** Group key for activity lists (notifications): today / 7 days / 30 days / older. */
export function timeBucket(
  value: string | Date,
  now: Date = new Date(),
): TimeBucket {
  const days = (startOfDay(now) - startOfDay(toDate(value))) / DAY;
  if (days < 1) return 'today';
  if (days < 7) return 'week';
  if (days < 30) return 'month';
  return 'earlier';
}

const compactNumber = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Social-style counts: `999`, `1.2K`, `3.4M`. */
export function formatCount(value: number): string {
  return value < 1000 ? String(value) : compactNumber.format(value);
}
