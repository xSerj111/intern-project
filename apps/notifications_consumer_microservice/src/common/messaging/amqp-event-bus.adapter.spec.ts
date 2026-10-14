import { Logger } from '@nestjs/common';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';
import { EXCHANGE_NAME, RoutingKeys } from '@repo/shared';
import type { EmailJob, EventEnvelope } from '@repo/shared';
import { AmqpEventBusAdapter } from './amqp-event-bus.adapter';

describe('AmqpEventBusAdapter', () => {
  let channel: { publish: jest.Mock; sendToQueue: jest.Mock; close: jest.Mock };
  let connection: { createChannel: jest.Mock };
  let bus: AmqpEventBusAdapter;

  const envelope: EventEnvelope<{ unseenCount: number }> = {
    eventId: '0b8a7c1e-9a6f-4c1e-8f0e-3c1f1b2a7d11',
    type: RoutingKeys.NOTIFICATION_SEEN,
    version: 1,
    occurredAt: '2026-10-14T10:00:00.000Z',
    payload: { unseenCount: 0 },
  };

  beforeEach(() => {
    channel = {
      publish: jest.fn().mockResolvedValue(true),
      sendToQueue: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };
    connection = { createChannel: jest.fn().mockReturnValue(channel) };
    bus = new AmqpEventBusAdapter(
      connection as unknown as AmqpConnectionManager,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('creates a confirm channel that declares the topology', async () => {
    const [opts] = connection.createChannel.mock.calls[0] as [
      { confirm: boolean; setup: (ch: ConfirmChannel) => Promise<void> },
    ];
    const raw = {
      assertExchange: jest.fn().mockResolvedValue({}),
      assertQueue: jest.fn().mockResolvedValue({}),
      bindQueue: jest.fn().mockResolvedValue({}),
    };

    await opts.setup(raw as unknown as ConfirmChannel);

    expect(opts.confirm).toBe(true);
    expect(raw.assertExchange).toHaveBeenCalledWith(EXCHANGE_NAME, 'topic', {
      durable: true,
    });
    expect(raw.assertQueue).toHaveBeenCalledWith('notifications.email', {
      durable: true,
    });
  });

  it('publishes a persistent JSON message on the given routing key', async () => {
    await bus.publish(RoutingKeys.NOTIFICATION_SEEN, envelope);

    const [exchange, key, content, options] = channel.publish.mock.calls[0] as [
      string,
      string,
      Buffer,
      Record<string, unknown>,
    ];
    expect(exchange).toBe(EXCHANGE_NAME);
    expect(key).toBe(RoutingKeys.NOTIFICATION_SEEN);
    expect(JSON.parse(content.toString('utf8'))).toEqual(envelope);
    expect(options).toMatchObject({
      persistent: true,
      messageId: envelope.eventId,
      contentType: 'application/json',
    });
  });

  it('rejects when the broker does not confirm', async () => {
    channel.publish.mockRejectedValueOnce(new Error('message nacked'));

    await expect(
      bus.publish(RoutingKeys.NOTIFICATION_SEEN, envelope),
    ).rejects.toThrow('message nacked');
  });

  it('enqueues an email job directly on notifications.email as attempt 1', async () => {
    const job = { jobId: 'e:r', summary: 'Anna liked your post' } as EmailJob;

    await bus.enqueueEmail(job);

    const [queue, content, options] = channel.sendToQueue.mock.calls[0] as [
      string,
      Buffer,
      Record<string, unknown>,
    ];
    expect(queue).toBe('notifications.email');
    expect(JSON.parse(content.toString('utf8'))).toEqual(job);
    expect(options).toMatchObject({
      persistent: true,
      messageId: 'e:r',
      headers: { 'x-attempts': 1 },
    });
  });

  it('closes its channel before shutdown, bounded by a timeout', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.useFakeTimers();
    channel.close.mockReturnValueOnce(new Promise<void>(() => undefined));

    const closing = bus.beforeApplicationShutdown();
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(closing).resolves.toBeUndefined();
    expect(channel.close).toHaveBeenCalledTimes(1);
  });
});
