import { Registry } from 'prom-client';
import {
  createAmqpMetrics,
  observeAmqpHandler,
  recordAmqpOutcome,
} from './amqp-metrics';

describe('amqp metrics', () => {
  it('registers both metrics once per registry (get-or-create)', async () => {
    const registry = new Registry();
    const first = createAmqpMetrics(registry);
    const second = createAmqpMetrics(registry);

    expect(second.messages).toBe(first.messages);
    expect(second.handlerDuration).toBe(first.handlerDuration);

    recordAmqpOutcome(first, 'notifications.events', 'ack');
    recordAmqpOutcome(second, 'notifications.events', 'retry');
    recordAmqpOutcome(first, 'notifications.events', 'dlq');
    recordAmqpOutcome(first, 'notifications.email', 'drop');
    observeAmqpHandler(first, 'notifications.events', 0.05);

    const text = await registry.metrics();
    for (const [queue, outcome] of [
      ['notifications.events', 'ack'],
      ['notifications.events', 'retry'],
      ['notifications.events', 'dlq'],
      ['notifications.email', 'drop'],
    ]) {
      expect(text).toContain(
        `amqp_messages_total{queue="${queue}",outcome="${outcome}"} 1`,
      );
    }
    expect(text).toContain(
      'amqp_handler_duration_seconds_count{queue="notifications.events"} 1',
    );
  });

  it('is a no-op without metrics', () => {
    expect(() => recordAmqpOutcome(undefined, 'q', 'ack')).not.toThrow();
    expect(() => observeAmqpHandler(undefined, 'q', 1)).not.toThrow();
  });
});
