import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { EXCHANGE_NAME, EventEnvelope } from '@repo/shared';
import { AMQP_CONNECTION } from './amqp-connection.provider';
import { EventBusPort } from './event-bus.port';

/** Rejects a publish that the broker has not confirmed within this window. */
const PUBLISH_TIMEOUT_MS = 10_000;

/** Upper bound on closing the channel, so shutdown never hangs on it. */
const CLOSE_TIMEOUT_MS = 2_000;

@Injectable()
export class AmqpEventBus implements EventBusPort, OnModuleDestroy {
  private readonly logger = new Logger(AmqpEventBus.name);
  private readonly channel: ChannelWrapper;

  constructor(@Inject(AMQP_CONNECTION) connection: AmqpConnectionManager) {
    // Confirm channel: publish() resolves on broker ack, rejects on nack/close.
    this.channel = connection.createChannel({
      name: 'core-event-bus',
      confirm: true,
      publishTimeout: PUBLISH_TIMEOUT_MS,
      // Re-run on every reconnect; assertExchange is idempotent.
      setup: async (channel: ConfirmChannel) => {
        await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
      },
    });
  }

  async publish<T>(envelope: EventEnvelope<T>): Promise<void> {
    await this.channel.publish(
      EXCHANGE_NAME,
      envelope.type,
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

  async onModuleDestroy(): Promise<void> {
    // channel.close() can stay pending forever if the connection is already
    // gone, so bound it and never let it fail the shutdown.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn('Timed out closing the AMQP channel');
        resolve();
      }, CLOSE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.channel.close(), timeout]);
    } catch (err) {
      this.logger.warn(
        `Failed to close the AMQP channel: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
