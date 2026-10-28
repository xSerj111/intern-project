import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import type { Channel, ConsumeMessage, Options } from 'amqplib';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Registry } from 'prom-client';
import {
  CORRELATION_ID_HEADER,
  EXCHANGE_NAME,
  NotificationCreatedPayload,
  NotificationSeenPayload,
  RoutingKeys,
  createAmqpMetrics,
  createErrorsCounter,
  currentRequestId,
  observeAmqpHandler,
  recordAmqpOutcome,
  recordError,
  resolveRequestId,
  runWithRequestContext,
  type AmqpMetrics,
  type ErrorsCounter,
} from '@repo/shared';
import { AMQP_CONNECTION } from '../../common/messaging/amqp-connection.provider';
import { METRICS_REGISTRY } from '../../common/observability/metrics.tokens';
import {
  CHAT_REALTIME_PORT,
  type IChatRealtimePort,
} from '../chats/domain/interfaces/chat-realtime.port';

export const RELAY_QUEUE = 'core.realtime-relay';
/** Overrides the queue name (e2e isolation only); see `resolveQueue`. */
export const RELAY_QUEUE_ENV = 'NOTIFICATIONS_RELAY_QUEUE';
export const RELAY_BINDING = 'notification.#';

/** Unacked messages in flight; emitting is cheap, so a small window is plenty. */
const PREFETCH = 10;

/** Upper bound on closing the channel, so shutdown never hangs on it. */
const CLOSE_TIMEOUT_MS = 2_000;

/** What to do with a delivery once it has been processed. */
export type RelayOutcome = 'ack' | 'requeue';

/**
 * Queue name and declaration options. The default is the durable contract
 * queue; any override is a throwaway queue so competing test apps never
 * share (or leave behind) the real one.
 */
export function resolveQueue(env: NodeJS.ProcessEnv = process.env): {
  name: string;
  options: Options.AssertQueue;
} {
  const name = env[RELAY_QUEUE_ENV]?.trim() || RELAY_QUEUE;
  return name === RELAY_QUEUE
    ? { name, options: { durable: true } }
    : { name, options: { durable: false, autoDelete: true } };
}

/**
 * Live relay of notifications: consumes `notification.#` from the durable
 * queue `core.realtime-relay` and emits to the recipient's `user:{id}` room.
 * Core stores nothing; the list and unseen count in the notifications service
 * stay the source of truth, so this path is best effort.
 */
@Injectable()
export class NotificationsRelayConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsRelayConsumer.name);
  private channel?: ChannelWrapper;
  private closing = false;
  private readonly errors: ErrorsCounter;
  private readonly metrics: AmqpMetrics;

  constructor(
    @Inject(AMQP_CONNECTION) private readonly connection: AmqpConnectionManager,
    @Inject(CHAT_REALTIME_PORT) private readonly realtime: IChatRealtimePort,
    @Inject(METRICS_REGISTRY) registry: Registry,
  ) {
    this.errors = createErrorsCounter(registry);
    this.metrics = createAmqpMetrics(registry);
  }

  onModuleInit(): void {
    const queue = resolveQueue();
    const channel = this.connection.createChannel({
      name: 'core-notifications-relay',
      // Re-run on every reconnect; the asserts are idempotent.
      setup: async (ch: Channel) => {
        await ch.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
        await ch.assertQueue(queue.name, queue.options);
        await ch.bindQueue(queue.name, EXCHANGE_NAME, RELAY_BINDING);
        await ch.prefetch(PREFETCH);
        await ch.consume(queue.name, (msg) => {
          if (msg) {
            this.onMessage(msg).catch((err: Error) =>
              this.logger.warn(`Relay message handling failed: ${err.message}`),
            );
          }
        });
      },
    });
    // Without listeners an 'error' (e.g. a setup that races shutdown, or
    // "Channel ended") would be an unhandled event and kill the process.
    channel.on('error', (err: Error) =>
      this.logger.warn(`AMQP relay channel error: ${err?.message}`),
    );
    channel.on('close', () => {
      if (!this.closing) this.logger.warn('AMQP relay channel closed');
    });
    this.channel = channel;
  }

  /**
   * Handles one delivery inside a request context whose id is the message's
   * `x-correlation-id` header (or a fresh UUID), so its logs correlate.
   */
  async onMessage(msg: ConsumeMessage): Promise<void> {
    const correlationId = resolveRequestId(
      msg.properties.headers?.[CORRELATION_ID_HEADER],
    );
    await runWithRequestContext(correlationId, async () => {
      const outcome = await this.process(msg);
      this.settle(msg, outcome);
    });
  }

  /** Acks or nacks unless the channel is going away; never throws. */
  private settle(msg: ConsumeMessage, outcome: RelayOutcome): void {
    // The delivery tag dies with the channel; the broker redelivers anyway.
    if (this.closing || !this.channel) return;
    try {
      if (outcome === 'ack') this.channel.ack(msg);
      else this.channel.nack(msg, false, true);
    } catch (err) {
      this.logger.warn(
        `Could not ${outcome === 'ack' ? 'ack' : 'nack'} relay message: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Decides the fate of one delivery. Invalid payloads are dropped (ack) with
   * a warning. A handler failure counts in `errors_total{source="amqp"}` and
   * is requeued once; if the message is already a redelivery it is dropped
   * with a warning instead. Outcomes count in `amqp_messages_total` (there is
   * no retry queue or DLQ here: every discard is `drop`, a requeue counts
   * nothing until the redelivery is processed).
   */
  async process(msg: ConsumeMessage): Promise<RelayOutcome> {
    const routingKey = msg.fields.routingKey;
    try {
      const payload = this.parseEnvelopePayload(msg);
      if (payload === undefined) {
        this.logger.warn(`Dropping malformed envelope for "${routingKey}"`);
        return this.dropped();
      }

      const handled = await this.timed(() =>
        this.dispatch(routingKey, payload),
      );
      if (!handled) return this.dropped();
      recordAmqpOutcome(this.metrics, RELAY_QUEUE, 'ack');
      this.logger.debug(
        `Relayed ${RELAY_QUEUE} message ${routingKey} (correlationId=${currentRequestId()})`,
      );
      return 'ack';
    } catch (err) {
      recordError(this.errors, 'amqp', err);
      const reason = (err as Error).message;
      if (msg.fields.redelivered) {
        this.logger.warn(
          `Dropping "${routingKey}" after a failed retry: ${reason}`,
        );
        return this.dropped();
      }
      this.logger.warn(
        `Requeueing "${routingKey}" once after error: ${reason}`,
      );
      return 'requeue';
    }
  }

  private dropped(): RelayOutcome {
    recordAmqpOutcome(this.metrics, RELAY_QUEUE, 'drop');
    return 'ack';
  }

  /** `amqp_handler_duration_seconds` covers validation and emit, not parsing. */
  private async timed<T>(work: () => Promise<T>): Promise<T> {
    const start = process.hrtime.bigint();
    try {
      return await work();
    } finally {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      observeAmqpHandler(this.metrics, RELAY_QUEUE, seconds);
    }
  }

  /** Emits to the recipient; false when the message was discarded. */
  private async dispatch(
    routingKey: string,
    payload: object,
  ): Promise<boolean> {
    switch (routingKey) {
      case RoutingKeys.NOTIFICATION_CREATED: {
        const event = plainToInstance(NotificationCreatedPayload, payload);
        if (!(await this.isValid(event, routingKey))) return false;
        this.realtime.emitToUser(event.recipientId, 'notification:new', {
          notification: event.notification,
          unseenCount: event.unseenCount,
        });
        return true;
      }
      case RoutingKeys.NOTIFICATION_SEEN: {
        const event = plainToInstance(NotificationSeenPayload, payload);
        if (!(await this.isValid(event, routingKey))) return false;
        this.realtime.emitToUser(event.userId, 'notifications:seen', {
          unseenCount: 0,
        });
        return true;
      }
      default:
        this.logger.warn(`Dropping unknown routing key "${routingKey}"`);
        return false;
    }
  }

  private parseEnvelopePayload(msg: ConsumeMessage): object | undefined {
    let envelope: unknown;
    try {
      envelope = JSON.parse(msg.content.toString('utf8'));
    } catch {
      return undefined;
    }
    if (typeof envelope !== 'object' || envelope === null) return undefined;
    const payload = (envelope as { payload?: unknown }).payload;
    return typeof payload === 'object' && payload !== null
      ? payload
      : undefined;
  }

  private async isValid(event: object, routingKey: string): Promise<boolean> {
    const errors = await validate(event);
    if (errors.length === 0) return true;
    this.logger.warn(
      `Dropping invalid "${routingKey}" payload: ${errors
        .map((e) => e.property)
        .join(', ')}`,
    );
    return false;
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (!this.channel) return;
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
