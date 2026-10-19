import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  RoutingKeys,
  type EventEnvelope,
  type NotificationSeenPayload,
} from '@repo/shared';
import { EVENT_BUS, type IEventBus } from './domain/interfaces/event-bus.port';
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from './domain/interfaces/notification-repository.port';
import { NOTIFICATIONS_DEFAULT_LIMIT } from './dto/list-notifications-query.dto';
import {
  NotificationsPageResponseDto,
  UnseenCountResponseDto,
} from './dto/notification-response.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notifications: INotificationRepository,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /** Newest first; `before` is an exclusive `occurredAt` cursor. */
  async list(
    userId: string,
    options: { before?: string; limit?: number },
  ): Promise<NotificationsPageResponseDto> {
    const [{ items, hasMore }, unseenCount] = await Promise.all([
      this.notifications.page(userId, {
        before: options.before ? new Date(options.before) : undefined,
        limit: options.limit ?? NOTIFICATIONS_DEFAULT_LIMIT,
      }),
      this.notifications.unseenCount(userId),
    ]);
    return new NotificationsPageResponseDto(items, hasMore, unseenCount);
  }

  async unseenCount(userId: string): Promise<UnseenCountResponseDto> {
    return new UnseenCountResponseDto(
      await this.notifications.unseenCount(userId),
    );
  }

  /** Marks the caller's notifications up to `upTo` (default now) seen, then publishes `notification.seen`. */
  async markSeen(
    userId: string,
    upTo?: string,
  ): Promise<UnseenCountResponseDto> {
    const now = new Date();
    await this.notifications.markSeenUpTo(userId, upTo ? new Date(upTo) : now);
    const unseenCount = await this.notifications.unseenCount(userId);
    await this.publishSeen(userId, now);
    return new UnseenCountResponseDto(unseenCount);
  }

  /** The rows are already committed, so a broker failure is logged rather than failing the request. */
  private async publishSeen(userId: string, occurredAt: Date): Promise<void> {
    const envelope: EventEnvelope<NotificationSeenPayload> = {
      eventId: randomUUID(),
      type: RoutingKeys.NOTIFICATION_SEEN,
      version: 1,
      occurredAt: occurredAt.toISOString(),
      payload: { userId, unseenCount: 0 },
    };
    try {
      await this.eventBus.publish(RoutingKeys.NOTIFICATION_SEEN, envelope);
    } catch (error) {
      this.logger.warn(
        `Failed to publish notification.seen for ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
