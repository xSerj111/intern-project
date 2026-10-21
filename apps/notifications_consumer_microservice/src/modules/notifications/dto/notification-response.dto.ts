import type { NotificationSnapshot } from '@repo/shared';
import type { Notification } from '../domain/entities/notification.entity';
import { encodeNotificationCursor } from './notification-cursor';

/** Wire shape of `INotificationsPage` (`@repo/contracts`), plus `nextCursor`. */
export class NotificationsPageResponseDto {
  items: NotificationSnapshot[];
  hasMore: boolean;
  unseenCount: number;
  /** Pass as `before` to get the next page; `null` on the last page. */
  nextCursor: string | null;

  constructor(items: Notification[], hasMore: boolean, unseenCount: number) {
    this.items = items.map((item) => item.toSnapshot());
    this.hasMore = hasMore;
    this.unseenCount = unseenCount;
    const last = items[items.length - 1];
    this.nextCursor = hasMore && last ? encodeNotificationCursor(last) : null;
  }
}

/** Wire shape of `IUnseenCount` (`@repo/contracts`). */
export class UnseenCountResponseDto {
  unseenCount: number;

  constructor(unseenCount: number) {
    this.unseenCount = unseenCount;
  }
}
