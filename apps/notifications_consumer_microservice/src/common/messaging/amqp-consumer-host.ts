import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import type {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { RoutingKey } from '@repo/shared';
import { AMQP_CONNECTION } from './amqp-connection.provider';
import {
  assertNotificationsTopology,
  ConsumedQueue,
  EMAIL_QUEUE,
  EVENTS_QUEUE,
  topicMatches,
} from './amqp-topology';
import { closeWithTimeout } from './close-with-timeout';
import {
  DeliveryContext,
  EmailJobHandler,
  EventHandler,
  IConsumerRegistry,
  PoisonMessageError,
} from './consumer.types';
import {
  parseEmailJob,
  parseEnvelope,
  validatePayload,
} from './message-validation';
import {
  ATTEMPTS_HEADER,
  decideOnFailure,
  describeError,
  LAST_ERROR_HEADER,
  ORIGINAL_ROUTING_KEY_HEADER,
  readAttempt,
} from './retry-policy';

/** Bounds a broker confirm for a retry/DLQ re-publish. */
const PUBLISH_TIMEOUT_MS = 10_000;
/** Bounds cancelling consumers and closing the channel on shutdown. */
const CLOSE_TIMEOUT_MS = 2_000;
/** How long shutdown waits for in-flight handlers to finish. */
const DRAIN_TIMEOUT_MS = 10_000;

interface EventRoute {
  payloadType: new () => object;
  handler: EventHandler<object>;
}

/** A decoded, validated delivery bound to its handler. */
interface Prepared {
  handle(): Promise<void>;
  onExhausted?(error: unknown): Promise<void>;
}

/**
 * Consumes `notifications.events` and `notifications.email`, dispatches to
 * the registered handlers and runs the `x-attempts` retry / DLQ loop (see
 * `consumer.types.ts` for the ack/nack contract).
 *
 * Lifecycle: handlers register in `onModuleInit`; consuming starts in
 * `onApplicationBootstrap` (does not wait for the broker). On shutdown,
 * `onModuleDestroy` cancels the consumers, waits for in-flight handlers, then
 * closes this channel; the publisher channel and the connection close later.
 */
@Injectable()
export class AmqpConsumerHost
  implements IConsumerRegistry, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AmqpConsumerHost.name);
  private readonly eventRoutes = new Map<string, EventRoute>();
  private emailHandler: EmailJobHandler | null = null;
  private channel: ChannelWrapper | null = null;
  private started = false;
  private stopping = false;
  /** Consumers on the current raw channel (replaced on every reconnect). */
  private active: { channel: ConfirmChannel; tags: string[] } | null = null;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    @Inject(AMQP_CONNECTION) private readonly connection: AmqpConnectionManager,
  ) {}

  registerEventHandler<T extends object>(
    routingKeys: readonly RoutingKey[],
    payloadType: new () => T,
    handler: EventHandler<T>,
  ): void {
    this.assertNotStarted();
    for (const key of routingKeys) {
      if (!EVENTS_QUEUE.bindings.some((p) => topicMatches(p, key))) {
        throw new Error(`"${key}" is not bound to ${EVENTS_QUEUE.queue}`);
      }
      if (this.eventRoutes.has(key)) {
        throw new Error(`A handler for "${key}" is already registered`);
      }
      this.eventRoutes.set(key, {
        payloadType,
        handler,
      });
    }
  }

  registerEmailHandler(handler: EmailJobHandler): void {
    this.assertNotStarted();
    if (this.emailHandler) {
      throw new Error('An email job handler is already registered');
    }
    this.emailHandler = handler;
  }

  onApplicationBootstrap(): void {
    this.started = true;
    const queues: ConsumedQueue[] = [];
    if (this.eventRoutes.size > 0) queues.push(EVENTS_QUEUE);
    else
      this.logger.warn(
        `No event handlers: not consuming ${EVENTS_QUEUE.queue}`,
      );
    if (this.emailHandler) queues.push(EMAIL_QUEUE);
    else
      this.logger.warn(`No email handler: not consuming ${EMAIL_QUEUE.queue}`);

    // Confirm channel, so a retry/DLQ copy is confirmed before the original
    // is acked. The setup re-runs on every reconnect.
    this.channel = this.connection.createChannel({
      name: 'notifications-consumers',
      confirm: true,
      publishTimeout: PUBLISH_TIMEOUT_MS,
      setup: (channel: ConfirmChannel) => this.setup(channel, queues),
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    // 1. Stop new deliveries.
    const active = this.active;
    this.active = null;
    if (active) {
      await closeWithTimeout(
        () =>
          Promise.allSettled(active.tags.map((t) => active.channel.cancel(t))),
        CLOSE_TIMEOUT_MS,
        this.logger,
        'the AMQP consumers',
      );
    }

    // 2. Let in-flight handlers finish (they ack on this channel).
    if (this.inFlight.size > 0) {
      await closeWithTimeout(
        () => Promise.allSettled([...this.inFlight]),
        DRAIN_TIMEOUT_MS,
        this.logger,
        `${this.inFlight.size} in-flight message(s)`,
      );
    }

    // 3. Close the channel; unacked messages return to their queue.
    const channel = this.channel;
    if (channel) {
      await closeWithTimeout(
        () => channel.close(),
        CLOSE_TIMEOUT_MS,
        this.logger,
        'the AMQP consumer channel',
      );
    }
  }

  private assertNotStarted(): void {
    if (this.started) {
      throw new Error(
        'Register AMQP handlers in onModuleInit, before bootstrap',
      );
    }
  }

  private async setup(
    channel: ConfirmChannel,
    queues: readonly ConsumedQueue[],
  ): Promise<void> {
    await assertNotificationsTopology(channel);
    if (this.stopping) return;

    const tags: string[] = [];
    this.active = { channel, tags };
    for (const queue of queues) {
      // Per-consumer limit (global=false) for the consumer created next.
      await channel.prefetch(queue.prefetch, false);
      const { consumerTag } = await channel.consume(
        queue.queue,
        (msg) => {
          if (!msg) {
            this.logger.warn(`Consumer of ${queue.queue} cancelled by broker`);
            return;
          }
          this.track(this.process(channel, queue, msg));
        },
        { noAck: false },
      );
      tags.push(consumerTag);
    }
  }

  private track(work: Promise<void>): void {
    const tracked = work.catch((err: unknown) =>
      this.logger.error(`Unhandled consumer error: ${describeError(err)}`),
    );
    this.inFlight.add(tracked);
    void tracked.finally(() => this.inFlight.delete(tracked));
  }

  /** Never rejects: every outcome ends in ack, a re-publish + ack, or nack. */
  private async process(
    channel: ConfirmChannel,
    queue: ConsumedQueue,
    msg: ConsumeMessage,
  ): Promise<void> {
    const attempt = readAttempt(msg.properties.headers);
    const ctx: DeliveryContext = {
      attempt,
      maxAttempts: queue.maxAttempts,
      isFinalAttempt: attempt >= queue.maxAttempts,
      queue: queue.queue,
    };

    let prepared: Prepared | undefined;
    try {
      prepared = await this.prepare(queue, msg.content, ctx);
      await prepared.handle();
    } catch (error) {
      await this.onFailure(channel, queue, msg, ctx, error, prepared);
      return;
    }
    this.ack(channel, msg);
  }

  private async prepare(
    queue: ConsumedQueue,
    content: Buffer,
    ctx: DeliveryContext,
  ): Promise<Prepared> {
    if (queue === EMAIL_QUEUE) {
      const handler = this.emailHandler;
      if (!handler) throw new PoisonMessageError('No email job handler');
      const job = await parseEmailJob(content);
      return {
        handle: () => handler.handle(job, ctx),
        onExhausted: handler.onExhausted
          ? (error) => handler.onExhausted!(job, error, ctx)
          : undefined,
      };
    }

    const raw = await parseEnvelope(content);
    const route = this.eventRoutes.get(raw.type);
    if (!route) {
      throw new PoisonMessageError(`No handler for event type "${raw.type}"`);
    }
    const envelope = await validatePayload(raw, route.payloadType);
    const { handler } = route;
    return {
      handle: () => handler.handle(envelope, ctx),
      onExhausted: handler.onExhausted
        ? (error) => handler.onExhausted!(envelope, error, ctx)
        : undefined,
    };
  }

  private async onFailure(
    channel: ConfirmChannel,
    queue: ConsumedQueue,
    msg: ConsumeMessage,
    ctx: DeliveryContext,
    error: unknown,
    prepared: Prepared | undefined,
  ): Promise<void> {
    const decision = decideOnFailure({
      attempt: ctx.attempt,
      maxAttempts: queue.maxAttempts,
      poison: error instanceof PoisonMessageError,
      hasDeadLetterQueue: queue.deadLetterQueue !== null,
    });
    const label = `${queue.queue} message ${msg.properties.messageId ?? '?'} (attempt ${ctx.attempt}/${queue.maxAttempts})`;

    try {
      if (decision.action === 'retry') {
        this.logger.warn(`${label} failed, retrying: ${describeError(error)}`);
        await this.republish(
          channel,
          queue.retryQueue,
          msg,
          decision.nextAttempt,
          error,
        );
      } else {
        if (prepared?.onExhausted) {
          await prepared
            .onExhausted(error)
            .catch((hookErr: unknown) =>
              this.logger.error(
                `${label} onExhausted failed: ${describeError(hookErr)}`,
              ),
            );
        }
        if (decision.action === 'dead-letter') {
          await this.republish(
            channel,
            queue.deadLetterQueue!,
            msg,
            ctx.attempt,
            error,
          );
          this.logger.error(
            `${label} sent to ${queue.deadLetterQueue}: ${describeError(error)}`,
          );
        } else {
          this.logger.error(`${label} dropped: ${describeError(error)}`);
        }
      }
    } catch (moveErr) {
      // Could not park the copy: requeue the original as-is (same attempt).
      this.logger.error(
        `${label} could not be re-published, requeueing: ${describeError(moveErr)}`,
      );
      this.nack(channel, msg);
      return;
    }
    this.ack(channel, msg);
  }

  /** Copies the message to `queue` and waits for the broker's confirm. */
  private republish(
    channel: ConfirmChannel,
    queue: string,
    msg: ConsumeMessage,
    attempt: number,
    error: unknown,
  ): Promise<void> {
    const headers: Record<string, unknown> = msg.properties.headers ?? {};
    const props = msg.properties;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Confirm timeout publishing to ${queue}`)),
        PUBLISH_TIMEOUT_MS,
      );
      // Default exchange: the routing key is the queue name.
      channel.sendToQueue(
        queue,
        msg.content,
        {
          persistent: true,
          contentType: props.contentType as string | undefined,
          messageId: props.messageId as string | undefined,
          type: props.type as string | undefined,
          timestamp: props.timestamp as number | undefined,
          headers: {
            ...headers,
            [ATTEMPTS_HEADER]: attempt,
            [LAST_ERROR_HEADER]: describeError(error),
            [ORIGINAL_ROUTING_KEY_HEADER]:
              headers[ORIGINAL_ROUTING_KEY_HEADER] ?? msg.fields.routingKey,
          },
        },
        (err: unknown) => {
          clearTimeout(timer);
          if (err) {
            reject(err instanceof Error ? err : new Error(describeError(err)));
          } else resolve();
        },
      );
    });
  }

  // A closed channel throws here; the broker then redelivers the message.
  private ack(channel: ConfirmChannel, msg: ConsumeMessage): void {
    try {
      channel.ack(msg);
    } catch (err) {
      this.logger.warn(
        `Ack failed, message will be redelivered: ${describeError(err)}`,
      );
    }
  }

  private nack(channel: ConfirmChannel, msg: ConsumeMessage): void {
    try {
      channel.nack(msg, false, true);
    } catch (err) {
      this.logger.warn(
        `Nack failed, message will be redelivered: ${describeError(err)}`,
      );
    }
  }
}
