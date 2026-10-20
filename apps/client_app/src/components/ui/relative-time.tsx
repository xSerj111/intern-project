'use client';

import { useEffect, useState } from 'react';

import { formatFullDate, formatRelative } from '../../lib/format/time';

const TICK_MS = 60_000;

interface RelativeTimeProps {
  /** ISO timestamp. */
  value: string;
  className?: string;
}

/**
 * `<time>` showing a compact relative age (`5m`, `3h`, `Mar 4`) that refreshes
 * every minute; the full date is in the tooltip.
 */
export function RelativeTime({ value, className }: RelativeTimeProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time
      dateTime={value}
      title={formatFullDate(value)}
      className={className}
      // Server and client clocks differ; the client value wins.
      suppressHydrationWarning
    >
      {formatRelative(value, now)}
    </time>
  );
}
