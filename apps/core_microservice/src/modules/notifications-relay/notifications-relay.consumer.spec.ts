import type { ConsumeMessage } from 'amqplib';
import { Registry } from 'prom-client';
import { RoutingKeys, currentRequestId } from '@repo/shared';
import {
  NotificationsRelayConsumer,
  resolveQueue,
} from './notifications-relay.consumer';

const USER_ID = '7d0b6a0e-5a0e-4c53-9d6a-0f7f5f1f2a11';

const snapshot = {
  id: 'n1',
  kind: 'POST_LIKED',
  actor: { userId: USER_ID, username: 'a', displayName: 'A', avatarUrl: null },
  target: { type: 'POST', id: 'p1', postId: null },
  excerpt: null,
  occurredAt: '2026-01-01T00:00:00.000Z',
  seen: false,
};

function message(
  routingKey: string,
  payload: unknown,
  redelivered = false,
  raw?: string,
  headers?: Record<string, unknown>,
): ConsumeMessage {
  const body = raw ?? JSON.stringify({ type: routingKey, payload });
  return {
    content: Buffer.from(body),
    fields: { routingKey, redelivered },
    properties: { headers },
  } as unknown as ConsumeMessage;
}

describe('NotificationsRelayConsumer', () => {
  let realtime: { emitToUser: jest.Mock };
  let consumer: NotificationsRelayConsumer;
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;
  let registry: Registry;

  /** Current `errors_total{source="amqp",type}` value. */
  const amqpErrors = async (type: string): Promise<number> => {
    const metric = await registry.getSingleMetric('errors_total')?.get();
    return (
      metric?.values.find(
        (v) => v.labels.source === 'amqp' && v.labels.type === type,
      )?.value ?? 0
    );
  };

  beforeEach(() => {
    realtime = { emitToUser: jest.fn() };
    registry = new Registry();
    consumer = new NotificationsRelayConsumer(
      {} as never,
      realtime as never,
      registry,
    );
    warn = jest
      .spyOn(
        (consumer as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation();
    debug = jest
      .spyOn(
        (consumer as unknown as { logger: { debug: () => void } }).logger,
        'debug',
      )
      .mockImplementation();
  });

  /** Current value of a sample of `amqp_messages_total` / the duration count. */
  const amqpSample = async (
    name: string,
    labels: Record<string, string>,
  ): Promise<number | undefined> => {
    const base = name.replace(/_count$/, '');
    const metric = await registry.getSingleMetric(base)?.get();
    return metric?.values.find(
      (v) =>
        ((v as { metricName?: string }).metricName ?? base) === name &&
        Object.entries(labels).every(([k, val]) => v.labels[k] === val),
    )?.value;
  };
  const outcomes = (outcome: string) =>
    amqpSample('amqp_messages_total', {
      queue: 'core.realtime-relay',
      outcome,
    });

  describe('amqp metrics and success log', () => {
    const seen = { userId: USER_ID, unseenCount: 0 };

    it('counts ack, observes the handler duration and logs a debug line', async () => {
      await consumer.onMessage(
        message(RoutingKeys.NOTIFICATION_SEEN, seen, false, undefined, {
          'x-correlation-id': 'req-abc',
        }),
      );

      expect(await outcomes('ack')).toBe(1);
      expect(
        await amqpSample('amqp_handler_duration_seconds_count', {
          queue: 'core.realtime-relay',
        }),
      ).toBe(1);
      expect(debug).toHaveBeenCalledTimes(1);
      const [[line]] = debug.mock.calls as [string][];
      expect(line).toContain('core.realtime-relay');
      expect(line).toContain(RoutingKeys.NOTIFICATION_SEEN);
      expect(line).toContain('req-abc');
      expect(line).not.toContain(USER_ID);
    });

    it('counts malformed, invalid and unknown messages as drop', async () => {
      await consumer.process(
        message(RoutingKeys.NOTIFICATION_SEEN, null, false, '{not json'),
      );
      await consumer.process(
        message(RoutingKeys.NOTIFICATION_SEEN, { userId: 'x' }),
      );
      await consumer.process(message('notification.other', {}));

      expect(await outcomes('drop')).toBe(3);
      expect(await outcomes('ack')).toBeUndefined();
    });

    it('counts nothing on requeue, then drop when the redelivery fails too', async () => {
      realtime.emitToUser.mockImplementation(() => {
        throw new Error('socket down');
      });

      await consumer.process(message(RoutingKeys.NOTIFICATION_SEEN, seen));
      expect(await outcomes('drop')).toBeUndefined();
      expect(await outcomes('ack')).toBeUndefined();

      await consumer.process(
        message(RoutingKeys.NOTIFICATION_SEEN, seen, true),
      );
      expect(await outcomes('drop')).toBe(1);
    });
  });

  it('emits notification:new to the recipient', async () => {
    const outcome = await consumer.process(
      message(RoutingKeys.NOTIFICATION_CREATED, {
        recipientId: USER_ID,
        notification: snapshot,
        unseenCount: 3,
      }),
    );

    expect(outcome).toBe('ack');
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      USER_ID,
      'notification:new',
      { notification: snapshot, unseenCount: 3 },
    );
  });

  it('emits notifications:seen with a zero count', async () => {
    const outcome = await consumer.process(
      message(RoutingKeys.NOTIFICATION_SEEN, {
        userId: USER_ID,
        unseenCount: 0,
      }),
    );

    expect(outcome).toBe('ack');
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      USER_ID,
      'notifications:seen',
      { unseenCount: 0 },
    );
  });

  it.each([
    [
      'bad recipient id',
      RoutingKeys.NOTIFICATION_CREATED,
      { recipientId: 'nope', notification: snapshot, unseenCount: 1 },
    ],
    [
      'negative unseen count',
      RoutingKeys.NOTIFICATION_CREATED,
      { recipientId: USER_ID, notification: snapshot, unseenCount: -1 },
    ],
    [
      'non-zero seen count',
      RoutingKeys.NOTIFICATION_SEEN,
      { userId: USER_ID, unseenCount: 4 },
    ],
  ])('drops an invalid payload without requeue (%s)', async (_n, key, body) => {
    expect(await consumer.process(message(key, body))).toBe('ack');
    expect(realtime.emitToUser).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('drops malformed JSON and unknown routing keys', async () => {
    expect(
      await consumer.process(
        message(RoutingKeys.NOTIFICATION_SEEN, null, false, '{not json'),
      ),
    ).toBe('ack');
    expect(await consumer.process(message('notification.other', {}))).toBe(
      'ack',
    );
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  describe('handler failure', () => {
    const payload = { userId: USER_ID, unseenCount: 0 };

    beforeEach(() => {
      realtime.emitToUser.mockImplementation(() => {
        throw new Error('socket down');
      });
    });

    it('requeues the first delivery', async () => {
      expect(
        await consumer.process(message(RoutingKeys.NOTIFICATION_SEEN, payload)),
      ).toBe('requeue');
    });

    it('increments errors_total{source="amqp"} with the error class', async () => {
      await consumer.process(message(RoutingKeys.NOTIFICATION_SEEN, payload));
      await consumer.process(
        message(RoutingKeys.NOTIFICATION_SEEN, payload, true),
      );
      expect(await amqpErrors('Error')).toBe(2);
    });

    it('drops a redelivery with a warning', async () => {
      expect(
        await consumer.process(
          message(RoutingKeys.NOTIFICATION_SEEN, payload, true),
        ),
      ).toBe('ack');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Dropping'));
    });
  });

  it('does not count dropped invalid payloads as errors', async () => {
    await consumer.process(
      message(RoutingKeys.NOTIFICATION_SEEN, null, false, '{not json'),
    );
    expect(await amqpErrors('Error')).toBe(0);
  });

  describe('request context', () => {
    const payload = { userId: USER_ID, unseenCount: 0 };
    let seenId: string | undefined;

    beforeEach(() => {
      seenId = undefined;
      realtime.emitToUser.mockImplementation(() => {
        seenId = currentRequestId();
      });
    });

    it('runs the handler with the x-correlation-id header as the request id', async () => {
      await consumer.onMessage(
        message(RoutingKeys.NOTIFICATION_SEEN, payload, false, undefined, {
          'x-correlation-id': 'req-abc',
        }),
      );
      expect(seenId).toBe('req-abc');
    });

    it('falls back to a fresh UUID without a valid header', async () => {
      await consumer.onMessage(
        message(RoutingKeys.NOTIFICATION_SEEN, payload, false, undefined, {
          'x-correlation-id': 'bad id!',
        }),
      );
      expect(seenId).toMatch(/^[0-9a-f-]{36}$/);

      seenId = undefined;
      await consumer.onMessage(message(RoutingKeys.NOTIFICATION_SEEN, payload));
      expect(seenId).toMatch(/^[0-9a-f-]{36}$/);
      expect(currentRequestId()).toBeUndefined();
    });
  });

  it('acks or nacks on the channel according to the outcome', async () => {
    const channel = { ack: jest.fn(), nack: jest.fn() };
    (consumer as unknown as { channel: unknown }).channel = channel;
    realtime.emitToUser.mockImplementation(() => {
      throw new Error('boom');
    });
    const msg = message(RoutingKeys.NOTIFICATION_SEEN, {
      userId: USER_ID,
      unseenCount: 0,
    });

    await consumer.onMessage(msg);

    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('does not throw when ack fails or the consumer is closing', async () => {
    const channel = {
      ack: jest.fn(() => {
        throw new Error('Channel ended, no reply will be forthcoming');
      }),
      nack: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (consumer as unknown as { channel: unknown }).channel = channel;
    const msg = message(RoutingKeys.NOTIFICATION_SEEN, {
      userId: USER_ID,
      unseenCount: 0,
    });

    await expect(consumer.onMessage(msg)).resolves.toBeUndefined();
    expect(channel.ack).toHaveBeenCalledTimes(1);

    await consumer.onModuleDestroy();
    await consumer.onMessage(msg);
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('swallows a close failure on shutdown', async () => {
    (consumer as unknown as { channel: unknown }).channel = {
      close: jest.fn().mockRejectedValue(new Error('already closed')),
    };
    await expect(consumer.onModuleDestroy()).resolves.toBeUndefined();
  });

  describe('resolveQueue', () => {
    it('defaults to the durable contract queue', () => {
      expect(resolveQueue({})).toEqual({
        name: 'core.realtime-relay',
        options: { durable: true },
      });
    });

    it('uses a throwaway queue when overridden', () => {
      expect(
        resolveQueue({
          NOTIFICATIONS_RELAY_QUEUE: 'core.realtime-relay.e2e-1',
        }),
      ).toEqual({
        name: 'core.realtime-relay.e2e-1',
        options: { durable: false, autoDelete: true },
      });
    });
  });
});
