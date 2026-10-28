import { ApiProperty } from '@nestjs/swagger';
import type { NotificationKind, NotificationSnapshot } from '@repo/shared';
import type { Notification } from '../domain/entities/notification.entity';
import { encodeNotificationCursor } from './notification-cursor';

/** Documentation-only shape of `INotification.actor`. */
export class NotificationActorDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl!: string | null;
}

/** Documentation-only shape of `INotification.target`. */
export class NotificationTargetDto {
  @ApiProperty({ enum: ['POST', 'COMMENT', 'PROFILE'] })
  type!: 'POST' | 'COMMENT' | 'PROFILE';

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  postId!: string | null;
}

/** Documentation-only shape of `INotification` (`@repo/contracts`). */
export class NotificationItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ['POST_COMMENTED', 'POST_LIKED', 'COMMENT_LIKED', 'USER_FOLLOWED'],
  })
  kind!: NotificationKind;

  @ApiProperty({ type: NotificationActorDto })
  actor!: NotificationActorDto;

  @ApiProperty({ type: NotificationTargetDto })
  target!: NotificationTargetDto;

  @ApiProperty({ type: String, nullable: true })
  excerpt!: string | null;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;

  @ApiProperty()
  seen!: boolean;
}

/** Wire shape of `INotificationsPage` (`@repo/contracts`), plus `nextCursor`. */
export class NotificationsPageResponseDto {
  @ApiProperty({ type: [NotificationItemDto] })
  items: NotificationSnapshot[];

  @ApiProperty({ description: 'True when older notifications remain.' })
  hasMore: boolean;

  @ApiProperty({ description: 'Total unseen notifications for the caller.' })
  unseenCount: number;

  /** Pass as `before` to get the next page; `null` on the last page. */
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Pass as `before` to get the next page; null on the last page.',
  })
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
  @ApiProperty({ description: 'Unseen notifications for the caller.' })
  unseenCount: number;

  constructor(unseenCount: number) {
    this.unseenCount = unseenCount;
  }
}
