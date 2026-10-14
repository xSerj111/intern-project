import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ChatMessageAlertedPayload, RoutingKeys } from '@repo/shared';
import type { EmailJob, EventEnvelope } from '@repo/shared';
import { AppConfigService } from '../../../config/app-config.service';
import {
  CONSUMER_REGISTRY,
  type EventHandler,
  type IConsumerRegistry,
} from '../../../common/messaging/consumer.types';
import {
  PREFERENCES_REPOSITORY,
  type IPreferencesRepository,
} from '../../preferences/domain/interfaces/preferences-repository.port';
import { ProcessedEvent } from '../domain/entities/processed-event.entity';
import { EVENT_BUS, type IEventBus } from '../domain/interfaces/event-bus.port';
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from '../domain/interfaces/notification-repository.port';
import {
  PROCESSED_EVENT_REPOSITORY,
  type IProcessedEventRepository,
} from '../domain/interfaces/processed-event-repository.port';

const SUMMARY_MAX_LENGTH = 500;

/**
 * `chat.message.alerted`: email only, never stored (FR-034). The
 * `processed_events` marker makes it idempotent; `followUpDone` lets a
 * redelivery re-run a failed enqueue without sending a second job.
 */
@Injectable()
export class MessageAlertHandler
  implements EventHandler<ChatMessageAlertedPayload>, OnModuleInit
{
  constructor(
    @Inject(CONSUMER_REGISTRY) private readonly registry: IConsumerRegistry,
    @Inject(PROCESSED_EVENT_REPOSITORY)
    private readonly processedEvents: IProcessedEventRepository,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notifications: INotificationRepository,
    @Inject(PREFERENCES_REPOSITORY)
    private readonly preferences: IPreferencesRepository,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.registerEventHandler(
      [RoutingKeys.CHAT_MESSAGE_ALERTED],
      ChatMessageAlertedPayload,
      this,
    );
  }

  async handle(
    envelope: EventEnvelope<ChatMessageAlertedPayload>,
  ): Promise<void> {
    const inserted = await this.notifications.runInTransaction((tx) =>
      this.processedEvents.tryInsert(
        ProcessedEvent.record(envelope.eventId, envelope.type, new Date()),
        tx,
      ),
    );
    if (!inserted) {
      const existing = await this.processedEvents.findById(envelope.eventId);
      if (existing?.followUpDone) return;
    }

    const { payload } = envelope;
    // Preferences at this moment (FR-037).
    const prefs = await this.preferences.findByUserId(payload.recipientId);
    if (prefs.allowsEmailFor('NEW_MESSAGE')) {
      await this.eventBus.enqueueEmail(this.toEmailJob(envelope));
    }
    await this.processedEvents.markFollowUpDone(envelope.eventId);
  }

  private toEmailJob(
    envelope: EventEnvelope<ChatMessageAlertedPayload>,
  ): EmailJob {
    const { payload } = envelope;
    const name = payload.actor.displayName || payload.actor.username;
    const summary = payload.chatTitle
      ? `${name} sent a message in ${payload.chatTitle}`
      : `${name} sent you a message`;
    const clientUrl = this.config.clientUrl.replace(/\/+$/, '');
    return {
      // Deterministic per event + recipient: 73 chars, fits varchar(80).
      jobId: `${envelope.eventId}:${payload.recipientId}`,
      recipientId: payload.recipientId,
      kind: 'NEW_MESSAGE',
      actor: payload.actor,
      link: `${clientUrl}/messages/${payload.chatId}`,
      summary: summary.slice(0, SUMMARY_MAX_LENGTH),
      excerpt: payload.preview || null,
    };
  }
}
