import type { NotificationSnapshot } from '@repo/shared';
import type { Notification } from '../domain/entities/notification.entity';

/** Wire shape of `INotificationsPage` (`@repo/contracts`). */
export class NotificationsPageResponseDto {
  items: NotificationSnapshot[];
  hasMore: boolean;
  unseenCount: number;

  constructor(items: Notification[], hasMore: boolean, unseenCount: number) {
    this.items = items.map((item) => item.toSnapshot());
    this.hasMore = hasMore;
    this.unseenCount = unseenCount;
  }
}

/** Wire shape of `IUnseenCount` (`@repo/contracts`). */
export class UnseenCountResponseDto {
  unseenCount: number;

  constructor(unseenCount: number) {
    this.unseenCount = unseenCount;
  }
}
