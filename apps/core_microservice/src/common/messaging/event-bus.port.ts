import type { EventEnvelope } from '@repo/shared';

export const EVENT_BUS = Symbol.for('EVENT_BUS');

/**
 * Publishes integration events to the broker. Resolves only once the broker
 * has confirmed the message; rejects on nack, timeout or a closed channel (or with
 * `EventRejectedError` for an unpublishable event), so
 * callers (the outbox relay) can retry and keep at-least-once delivery.
 */
export interface EventBusPort {
  /** Routed by `envelope.type`, which equals the routing key. */
  publish<T>(envelope: EventEnvelope<T>): Promise<void>;
}

/**
 * Thrown by `publish` when the event itself cannot be published (e.g. its
 * payload cannot be serialized), so retrying can never succeed. Every other
 * rejection (nack, confirm timeout, closed channel, broker down) is treated as
 * broker-side and transient.
 */
export class EventRejectedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EventRejectedError';
  }
}
