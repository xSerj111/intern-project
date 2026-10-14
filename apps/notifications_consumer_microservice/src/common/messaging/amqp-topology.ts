import type { Channel } from 'amqplib';
import { EXCHANGE_NAME, RoutingKeys } from '@repo/shared';

/**
 * One consumed queue plus its retry loop (contracts/broker-events.md#Topology).
 * A failed delivery is re-published to `retryQueue` with `x-attempts + 1`;
 * the retry queue holds it for `retryTtlMs`, then dead-letters it straight
 * back to `queue` via the default exchange. After `maxAttempts` deliveries it
 * goes to `deadLetterQueue`, or is dropped when there is none.
 */
export interface ConsumedQueue {
  queue: string;
  retryQueue: string;
  retryTtlMs: number;
  deadLetterQueue: string | null;
  maxAttempts: number;
  prefetch: number;
  /** Topic patterns on `innogram.events`; empty = direct sends only. */
  bindings: readonly string[];
}

export const EVENTS_QUEUE: ConsumedQueue = {
  queue: 'notifications.events',
  retryQueue: 'notifications.events.retry',
  retryTtlMs: 10_000,
  deadLetterQueue: 'notifications.events.dlq',
  maxAttempts: 5,
  prefetch: 20,
  bindings: ['social.#', RoutingKeys.CHAT_MESSAGE_ALERTED],
};

/** Email jobs: 3 attempts, then the worker marks them FAILED (FR-039). */
export const EMAIL_QUEUE: ConsumedQueue = {
  queue: 'notifications.email',
  retryQueue: 'notifications.email.retry',
  retryTtlMs: 30_000,
  deadLetterQueue: null,
  maxAttempts: 3,
  prefetch: 5,
  bindings: [],
};

export const CONSUMED_QUEUES: readonly ConsumedQueue[] = [
  EVENTS_QUEUE,
  EMAIL_QUEUE,
];

/**
 * Idempotently declares the exchange and every notifications-owned queue.
 * Runs on each (re)connect of every channel, before anything is consumed or
 * sent: a direct send to an undeclared queue is silently dropped.
 */
export async function assertNotificationsTopology(
  channel: Pick<Channel, 'assertExchange' | 'assertQueue' | 'bindQueue'>,
): Promise<void> {
  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

  for (const q of CONSUMED_QUEUES) {
    await channel.assertQueue(q.queue, { durable: true });
    await channel.assertQueue(q.retryQueue, {
      durable: true,
      messageTtl: q.retryTtlMs,
      // '' = default exchange, so the routing key is the main queue's name.
      deadLetterExchange: '',
      deadLetterRoutingKey: q.queue,
    });
    if (q.deadLetterQueue) {
      await channel.assertQueue(q.deadLetterQueue, { durable: true });
    }
    for (const pattern of q.bindings) {
      await channel.bindQueue(q.queue, EXCHANGE_NAME, pattern);
    }
  }
}

/** AMQP topic match: `*` = exactly one word, `#` = zero or more words. */
export function topicMatches(pattern: string, routingKey: string): boolean {
  const match = (p: string[], k: string[]): boolean => {
    if (p.length === 0) return k.length === 0;
    const [head, ...rest] = p;
    if (head === '#') {
      return k.some((_, i) => match(rest, k.slice(i))) || match(rest, []);
    }
    if (k.length === 0) return false;
    return (head === '*' || head === k[0]) && match(rest, k.slice(1));
  };
  return match(pattern.split('.'), routingKey.split('.'));
}
