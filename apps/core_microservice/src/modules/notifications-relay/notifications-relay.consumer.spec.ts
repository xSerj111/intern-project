import type { ConsumeMessage } from 'amqplib';
import { RoutingKeys } from '@repo/shared';
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
): ConsumeMessage {
  const body = raw ?? JSON.stringify({ type: routingKey, payload });
  return {
    content: Buffer.from(body),
    fields: { routingKey, redelivered },
    properties: {},
  } as unknown as ConsumeMessage;
}

describe('NotificationsRelayConsumer', () => {
  let realtime: { emitToUser: jest.Mock };
  let consumer: NotificationsRelayConsumer;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    realtime = { emitToUser: jest.fn() };
    consumer = new NotificationsRelayConsumer({} as never, realtime as never);
    warn = jest
      .spyOn(
        (consumer as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation();
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

    it('drops a redelivery with a warning', async () => {
      expect(
        await consumer.process(
          message(RoutingKeys.NOTIFICATION_SEEN, payload, true),
        ),
      ).toBe('ack');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Dropping'));
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
