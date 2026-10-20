import type { INotification } from '@repo/contracts';

import {
  TIME_BUCKET_LABELS,
  timeBucket,
  type TimeBucket,
} from '../../lib/format/time';

export interface NotificationGroup {
  bucket: TimeBucket;
  label: string;
  items: INotification[];
}

const BUCKET_ORDER: TimeBucket[] = ['today', 'week', 'month', 'earlier'];

/**
 * Split a newest-first list into Today / This week / This month / Earlier,
 * dropping empty buckets and keeping the incoming order inside each one.
 */
export function groupNotifications(
  items: INotification[],
  now: Date = new Date(),
): NotificationGroup[] {
  const buckets = new Map<TimeBucket, INotification[]>();
  for (const item of items) {
    const bucket = timeBucket(item.occurredAt, now);
    const list = buckets.get(bucket);
    if (list) {
      list.push(item);
    } else {
      buckets.set(bucket, [item]);
    }
  }
  return BUCKET_ORDER.flatMap((bucket) => {
    const list = buckets.get(bucket);
    return list
      ? [{ bucket, label: TIME_BUCKET_LABELS[bucket], items: list }]
      : [];
  });
}
