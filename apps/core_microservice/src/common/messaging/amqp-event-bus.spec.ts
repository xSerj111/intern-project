import type { AmqpConnectionManager } from 'amqp-connection-manager';
import { Logger } from '@nestjs/common';
import type { ConfirmChannel } from 'amqplib';
import { EXCHANGE_NAME, EventEnvelope, RoutingKeys } from '@repo/shared';
import { AmqpEventBus } from './amqp-event-bus';

describe('AmqpEventBus', () => {
  let channel: { publish: jest.Mock; close: jest.Mock };
  let connection: { createChannel: jest.Mock };
  let bus: AmqpEventBus;

  const envelope: EventEnvelope<{ postId: string }> = {
    eventId: '0b8a7c1e-9a6f-4c1e-8f0e-3c1f1b2a7d11',
    type: RoutingKeys.POST_LIKED,
    version: 1,
    occurredAt: '2026-10-14T10:00:00.000Z',
    payload: { postId: 'post-1' },
  };

  beforeEach(() => {
    channel = {
      publish: jest.fn().mockResolvedValue(true),
      close: jest.fn().mockResolvedValue(undefined),
    };
    connection = {
      createChannel: jest.fn().mockReturnValue(channel),
    };
    bus = new AmqpEventBus(connection as unknown as AmqpConnectionManager);
  });

  it('creates a confirm channel', () => {
    expect(connection.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ confirm: true }),
    );
  });

  it('asserts the durable topic exchange on channel setup', async () => {
    const [{ setup }] = connection.createChannel.mock.calls[0] as [
      { setup: (ch: ConfirmChannel) => Promise<void> },
    ];
    const raw = { assertExchange: jest.fn().mockResolvedValue({}) };

    await setup(raw as unknown as ConfirmChannel);

    expect(raw.assertExchange).toHaveBeenCalledWith(EXCHANGE_NAME, 'topic', {
      durable: true,
    });
  });

  it('publishes a persistent JSON message routed by the envelope type', async () => {
    await bus.publish(envelope);

    expect(channel.publish).toHaveBeenCalledTimes(1);
    const [exchange, routingKey, content, options] = channel.publish.mock
      .calls[0] as [string, string, Buffer, Record<string, unknown>];
    expect(exchange).toBe(EXCHANGE_NAME);
    expect(routingKey).toBe(RoutingKeys.POST_LIKED);
    expect(JSON.parse(content.toString('utf8'))).toEqual(envelope);
    expect(options).toEqual(
      expect.objectContaining({
        persistent: true,
        messageId: envelope.eventId,
        contentType: 'application/json',
        type: envelope.type,
      }),
    );
  });

  it('rejects when the broker nacks or the channel closes', async () => {
    channel.publish.mockRejectedValueOnce(new Error('message nacked'));

    await expect(bus.publish(envelope)).rejects.toThrow('message nacked');
  });

  it('closes its channel on module destroy', async () => {
    await bus.onModuleDestroy();

    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  describe('when the connection is already gone', () => {
    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('swallows a channel close error', async () => {
      channel.close.mockRejectedValueOnce(new Error('connection closed'));

      await expect(bus.onModuleDestroy()).resolves.toBeUndefined();
    });

    it('does not wait forever for a channel close that never settles', async () => {
      jest.useFakeTimers();
      channel.close.mockReturnValueOnce(new Promise<void>(() => undefined));

      const closing = bus.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(2_000);

      await expect(closing).resolves.toBeUndefined();
    });
  });
});
