import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CommentLikedPayload,
  PostCommentedPayload,
  PostLikedPayload,
  RoutingKeys,
  UserFollowedPayload,
  type EmailJob,
  type EventEnvelope,
  type NotificationCreatedPayload,
  type NotificationKind,
} from '@repo/shared';
import { AppConfigService } from '../../../config/app-config.service';
import {
  CONSUMER_REGISTRY,
  PoisonMessageError,
  type EventHandler,
  type IConsumerRegistry,
} from '../../../common/messaging/consumer.types';
import {
  PREFERENCES_REPOSITORY,
  type IPreferencesRepository,
} from '../../preferences/domain/interfaces/preferences-repository.port';
import {
  Notification,
  type SocialEventPayload,
} from '../domain/entities/notification.entity';
import { ProcessedEvent } from '../domain/entities/processed-event.entity';
import { UnsupportedNotificationEventError } from '../domain/errors/notification.errors';
import { EVENT_BUS, type IEventBus } from '../domain/interfaces/event-bus.port';
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../domain/interfaces/notification-repository.port';
import {
  PROCESSED_EVENT_REPOSITORY,
  type IProcessedEventRepository,
} from '../domain/interfaces/processed-event-repository.port';

const SUMMARY: Record<NotificationKind, string> = {
  POST_COMMENTED: 'commented on your post',
  POST_LIKED: 'liked your post',
  COMMENT_LIKED: 'liked your comment',
  USER_FOLLOWED: 'started following you',
};

/** Outcome of the transactional step for one delivery. */
type StoreOutcome =
  { replay: false; notification: Notification | null } | { replay: true };

/**
 * Consumes `social.*` events (contracts/broker-events.md, "Consumer
 * processing order"): marker + notification in one transaction, then the
 * post-commit follow-ups (`notification.created`, email job), guarded by
 * `processed_events.followUpDone` so a redelivery re-runs only those.
 */
@Injectable()
export class SocialEventHandler
  implements EventHandler<SocialEventPayload>, OnModuleInit
{
  private readonly logger = new Logger(SocialEventHandler.name);

  constructor(
    @Inject(CONSUMER_REGISTRY) private readonly registry: IConsumerRegistry,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notifications: INotificationRepository,
    @Inject(PROCESSED_EVENT_REPOSITORY)
    private readonly processedEvents: IProcessedEventRepository,
    @Inject(PREFERENCES_REPOSITORY)
    private readonly preferences: IPreferencesRepository,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.registerEventHandler(
      [RoutingKeys.POST_COMMENTED],
      PostCommentedPayload,
      this,
    );
    this.registry.registerEventHandler(
      [RoutingKeys.POST_LIKED],
      PostLikedPayload,
      this,
    );
    this.registry.registerEventHandler(
      [RoutingKeys.COMMENT_LIKED],
      CommentLikedPayload,
      this,
    );
    this.registry.registerEventHandler(
      [RoutingKeys.USER_FOLLOWED],
      UserFollowedPayload,
      this,
    );
  }

  async handle(envelope: EventEnvelope<SocialEventPayload>): Promise<void> {
    const outcome = await this.store(envelope);

    let notification: Notification | null;
    if (outcome.replay) {
      const marker = await this.processedEvents.findById(envelope.eventId);
      if (!marker || marker.followUpDone) {
        return;
      }
      notification = await this.notifications.findBySourceEventId(
        envelope.eventId,
      );
    } else {
      notification = outcome.notification;
    }

    if (notification) {
      await this.publishCreated(notification);
      await this.enqueueEmailIfAllowed(envelope.eventId, notification);
    }
    await this.processedEvents.markFollowUpDone(envelope.eventId);
  }

  /** Step 2: marker and notification commit together, or not at all. */
  private async store(
    envelope: EventEnvelope<SocialEventPayload>,
  ): Promise<StoreOutcome> {
    return this.notifications.runInTransaction(async (tx) => {
      const marker = ProcessedEvent.record(
        envelope.eventId,
        envelope.type,
        new Date(),
      );
      if (!(await this.processedEvents.tryInsert(marker, tx))) {
        return { replay: true };
      }

      const notification = this.buildNotification(envelope);
      if (!notification) {
        return { replay: false, notification: null };
      }
      if (!(await this.notifications.insert(notification, tx))) {
        // Same like already notified (partial-unique index): a duplicate.
        this.logger.debug(
          `Duplicate ${notification.kind} for ${notification.recipientId}; event ${envelope.eventId} skipped`,
        );
        return { replay: false, notification: null };
      }
      return { replay: false, notification };
    });
  }

  private buildNotification(
    envelope: EventEnvelope<SocialEventPayload>,
  ): Notification | null {
    try {
      return Notification.fromEvent(envelope);
    } catch (error) {
      if (error instanceof UnsupportedNotificationEventError) {
        throw new PoisonMessageError(error.message);
      }
      throw error;
    }
  }

  /** Step 3: live relay through core. */
  private async publishCreated(notification: Notification): Promise<void> {
    const unseenCount = await this.notifications.unseenCount(
      notification.recipientId,
    );
    const envelope: EventEnvelope<NotificationCreatedPayload> = {
      eventId: randomUUID(),
      type: RoutingKeys.NOTIFICATION_CREATED,
      version: 1,
      occurredAt: new Date().toISOString(),
      payload: {
        recipientId: notification.recipientId,
        notification: notification.toSnapshot(),
        unseenCount,
      },
    };
    await this.eventBus.publish(RoutingKeys.NOTIFICATION_CREATED, envelope);
  }

  /** Step 4: the recipient (never the actor) gets an email if the kind is on. */
  private async enqueueEmailIfAllowed(
    eventId: string,
    notification: Notification,
  ): Promise<void> {
    const prefs = await this.preferences.findByUserId(notification.recipientId);
    if (!prefs.allowsEmailFor(notification.kind)) {
      return;
    }

    const actor = {
      userId: notification.actorId,
      ...notification.actorSnapshot,
    };
    const job: EmailJob = {
      // Deterministic, so a re-run follow-up does not send a second email.
      jobId: `${eventId}:${notification.recipientId}`,
      recipientId: notification.recipientId,
      kind: notification.kind,
      actor,
      link: this.linkFor(notification),
      summary: `${actor.displayName} ${SUMMARY[notification.kind]}`,
      excerpt: notification.excerpt,
    };
    await this.eventBus.enqueueEmail(job);
  }

  /** POST/COMMENT go to the post; PROFILE goes to the actor's profile. */
  private linkFor(notification: Notification): string {
    const base = this.config.clientUrl.replace(/\/+$/, '');
    switch (notification.targetType) {
      case 'POST':
        return `${base}/posts/${notification.targetId}`;
      case 'COMMENT':
        return `${base}/posts/${notification.postId ?? ''}`;
      case 'PROFILE':
        return `${base}/profile/${notification.actorId}`;
    }
  }
}
