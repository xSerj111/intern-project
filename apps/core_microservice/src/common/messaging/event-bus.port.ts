import type { EventEnvelope } from '@repo/shared';

export const EVENT_BUS = Symbol.for('EVENT_BUS');

/**
 * Publishes integration events to the broker. Resolves only once the broker
 * has confirmed the message; rejects on nack, timeout or a closed channel, so
 * callers (the outbox relay) can retry and keep at-least-once delivery.
 */
export interface EventBusPort {
  /** Routed by `envelope.type`, which equals the routing key. */
  publish<T>(envelope: EventEnvelope<T>): Promise<void>;
}
