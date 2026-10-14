import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { EXCHANGE_NAME } from '@repo/shared';
import type { EmailJob, EventEnvelope, RoutingKey } from '@repo/shared';
import type { IEventBus } from '../../modules/notifications/domain/interfaces/event-bus.port';
import { AMQP_CONNECTION } from './amqp-connection.provider';
import { assertNotificationsTopology, EMAIL_QUEUE } from './amqp-topology';
import { closeWithTimeout } from './close-with-timeout';
import { ATTEMPTS_HEADER } from './retry-policy';

/** Rejects a publish that the broker has not confirmed within this window. */
const PUBLISH_TIMEOUT_MS = 10_000;

/** Upper bound on closing the channel, so shutdown never hangs on it. */
const CLOSE_TIMEOUT_MS = 2_000;

/**
 * `EVENT_BUS` adapter. Every publish goes through a confirm channel: it
 * resolves on broker ack and rejects on nack, timeout or a closed channel, so
 * a consumer handler that awaits it fails (and retries) instead of losing it.
 */
@Injectable()
export class AmqpEventBusAdapter
  implements IEventBus, BeforeApplicationShutdown
{
  private readonly logger = new Logger(AmqpEventBusAdapter.name);
  private readonly channel: ChannelWrapper;

  constructor(@Inject(AMQP_CONNECTION) connection: AmqpConnectionManager) {
    this.channel = connection.createChannel({
      name: 'notifications-event-bus',
      confirm: true,
      publishTimeout: PUBLISH_TIMEOUT_MS,
      // Re-run on every reconnect; every declaration is idempotent.
      setup: async (channel: ConfirmChannel) => {
        await assertNotificationsTopology(channel);
      },
    });
  }

  async publish<T>(
    routingKey: RoutingKey,
    envelope: EventEnvelope<T>,
  ): Promise<void> {
    await this.channel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(envelope)),
      {
        persistent: true,
        messageId: envelope.eventId,
        contentType: 'application/json',
        type: envelope.type,
        timestamp: Date.parse(envelope.occurredAt),
      },
    );
  }

  async enqueueEmail(job: EmailJob): Promise<void> {
    // Default exchange: the routing key is the queue name.
    await this.channel.sendToQueue(
      EMAIL_QUEUE.queue,
      Buffer.from(JSON.stringify(job)),
      {
        persistent: true,
        messageId: job.jobId,
        contentType: 'application/json',
        headers: { [ATTEMPTS_HEADER]: 1 },
      },
    );
  }

  /**
   * After every `onModuleDestroy`, i.e. after the consumers drained: their
   * in-flight handlers may still publish while draining.
   */
  async beforeApplicationShutdown(): Promise<void> {
    await closeWithTimeout(
      () => this.channel.close(),
      CLOSE_TIMEOUT_MS,
      this.logger,
      'the AMQP publisher channel',
    );
  }
}
