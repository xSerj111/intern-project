import type { EmailJob, EventEnvelope, RoutingKey } from '@repo/shared';

export interface IEventBus {
  /** Publishes to the `innogram.events` exchange (`notification.created`, `notification.seen`). */
  publish<T>(routingKey: RoutingKey, envelope: EventEnvelope<T>): Promise<void>;
  /** Puts the job on the `notifications.email` queue. */
  enqueueEmail(job: EmailJob): Promise<void>;
}

export const EVENT_BUS = Symbol.for('IEventBus');
