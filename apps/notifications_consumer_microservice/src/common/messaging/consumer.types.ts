import type { EmailJob, EventEnvelope, RoutingKey } from '@repo/shared';

/**
 * Ack/nack semantics for every registered handler:
 * - `handle` resolves      -> message acked.
 * - `handle` throws        -> re-published to the queue's retry queue with
 *   `x-attempts + 1` (then acked); redelivered after the retry TTL. On the last
 *   attempt it goes to the DLQ (events) or is dropped (email), after
 *   `onExhausted` runs.
 * - throws `PoisonMessageError` -> no retry: straight to the DLQ / dropped.
 * Invalid payloads never reach `handle`; they are treated as poison.
 * Delivery is at-least-once: handlers must be idempotent.
 */
export interface DeliveryContext {
  /** 1-based delivery number, from the `x-attempts` header. */
  attempt: number;
  maxAttempts: number;
  /** True when a throw now ends the retry loop. */
  isFinalAttempt: boolean;
  queue: string;
}

export interface EventHandler<T extends object = object> {
  /** `envelope.payload` is a validated instance of the registered class. */
  handle(envelope: EventEnvelope<T>, ctx: DeliveryContext): Promise<void>;
  /** Called once when the message leaves the retry loop unprocessed. */
  onExhausted?(
    envelope: EventEnvelope<T>,
    error: unknown,
    ctx: DeliveryContext,
  ): Promise<void>;
}

export interface EmailJobHandler {
  handle(job: EmailJob, ctx: DeliveryContext): Promise<void>;
  /** Last attempt failed: record the delivery as FAILED (FR-039). */
  onExhausted?(
    job: EmailJob,
    error: unknown,
    ctx: DeliveryContext,
  ): Promise<void>;
}

/**
 * Wave-4 handlers call this from `onModuleInit`; consumers start in
 * `onApplicationBootstrap`, so registering later throws.
 */
export interface IConsumerRegistry {
  /**
   * Handles `notifications.events` messages whose envelope `type` is one of
   * `routingKeys`. Each key may have one handler and must match a binding.
   */
  registerEventHandler<T extends object>(
    routingKeys: readonly RoutingKey[],
    payloadType: new () => T,
    handler: EventHandler<T>,
  ): void;
  /** Sole consumer of the `notifications.email` queue. */
  registerEmailHandler(handler: EmailJobHandler): void;
}

export const CONSUMER_REGISTRY = Symbol.for('IConsumerRegistry');

/** Throw from a handler when retrying cannot help: goes straight to the DLQ. */
export class PoisonMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoisonMessageError';
  }
}
