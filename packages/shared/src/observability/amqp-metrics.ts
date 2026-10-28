import { Counter, Histogram, Registry } from 'prom-client';

const MESSAGES_NAME = 'amqp_messages_total';
const DURATION_NAME = 'amqp_handler_duration_seconds';

/** What happened to a consumed message. */
export type AmqpOutcome = 'ack' | 'retry' | 'dlq' | 'drop';

export type AmqpMessagesCounter = Counter<'queue' | 'outcome'>;
export type AmqpHandlerDuration = Histogram<'queue'>;

export interface AmqpMetrics {
  messages: AmqpMessagesCounter;
  handlerDuration: AmqpHandlerDuration;
}

/** The part of the metrics callers need (kept minimal so tests can stub it). */
export interface AmqpMetricsLike {
  messages: Pick<AmqpMessagesCounter, 'inc'>;
  handlerDuration: Pick<AmqpHandlerDuration, 'observe'>;
}

/** Increments `amqp_messages_total{queue, outcome}`; a no-op without metrics. */
export function recordAmqpOutcome(
  metrics: AmqpMetricsLike | undefined,
  queue: string,
  outcome: AmqpOutcome,
): void {
  metrics?.messages.inc({ queue, outcome });
}

/** Observes `amqp_handler_duration_seconds{queue}`; a no-op without metrics. */
export function observeAmqpHandler(
  metrics: AmqpMetricsLike | undefined,
  queue: string,
  seconds: number,
): void {
  metrics?.handlerDuration.observe({ queue }, seconds);
}

/**
 * Get-or-create `amqp_messages_total{queue,outcome}` and
 * `amqp_handler_duration_seconds{queue}` on `registry`, so registering them
 * twice is safe. `queue` is a queue name, never a message or routing-key value.
 */
export function createAmqpMetrics(registry: Registry): AmqpMetrics {
  const messages =
    (registry.getSingleMetric(MESSAGES_NAME) as
      AmqpMessagesCounter | undefined) ??
    new Counter({
      name: MESSAGES_NAME,
      help: 'AMQP messages handled by queue and outcome (ack, retry, dlq, drop)',
      labelNames: ['queue', 'outcome'],
      registers: [registry],
    });
  const handlerDuration =
    (registry.getSingleMetric(DURATION_NAME) as
      AmqpHandlerDuration | undefined) ??
    new Histogram({
      name: DURATION_NAME,
      help: 'AMQP message handler duration in seconds by queue',
      labelNames: ['queue'],
      buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    });
  return { messages, handlerDuration };
}
