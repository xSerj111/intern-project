import { Logger } from '@nestjs/common';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { PostLikedPayload, RoutingKeys } from '@repo/shared';
import { AmqpConsumerHost } from './amqp-consumer-host';
import { PoisonMessageError } from './consumer.types';
import { ATTEMPTS_HEADER, ORIGINAL_ROUTING_KEY_HEADER } from './retry-policy';

const uuid = (n: number) => `0b8a7c1e-9a6f-4c1e-8f0e-3c1f1b2a7d${10 + n}`;

const likedEnvelope = {
  eventId: uuid(1),
  type: RoutingKeys.POST_LIKED,
  version: 1,
  occurredAt: '2026-10-14T10:00:00.000Z',
  payload: {
    actor: {
      userId: uuid(2),
      username: 'anna',
      displayName: 'Anna',
      avatarUrl: null,
    },
    recipientId: uuid(3),
    postId: uuid(4),
    excerpt: 'hello',
  },
};

const emailJob = {
  jobId: `${uuid(1)}:${uuid(3)}`,
  recipientId: uuid(3),
  kind: 'POST_LIKED',
  actor: likedEnvelope.payload.actor,
  link: 'http://localhost:3000/posts/1',
  summary: 'Anna liked your post',
  excerpt: null,
};

function message(
  body: unknown,
  headers: Record<string, unknown> = {},
  routingKey: string = RoutingKeys.POST_LIKED,
): ConsumeMessage {
  return {
    content: Buffer.from(
      typeof body === 'string' ? body : JSON.stringify(body),
    ),
    fields: { routingKey, deliveryTag: 1 },
    properties: { headers, messageId: 'm-1', contentType: 'application/json' },
  } as unknown as ConsumeMessage;
}

describe('AmqpConsumerHost', () => {
  let host: AmqpConsumerHost;
  let wrapper: { close: jest.Mock };
  let connection: { createChannel: jest.Mock };
  let channel: Record<string, jest.Mock>;
  let deliver: Record<string, (msg: ConsumeMessage | null) => void>;

  const eventHandler = { handle: jest.fn(), onExhausted: jest.fn() };
  const emailHandler = { handle: jest.fn(), onExhausted: jest.fn() };

  async function boot(): Promise<void> {
    host.onApplicationBootstrap();
    const [{ setup }] = connection.createChannel.mock.calls[0] as [
      { setup: (ch: ConfirmChannel) => Promise<void> },
    ];
    await setup(channel as unknown as ConfirmChannel);
  }

  /** Delivers and waits until the host has acked / nacked / re-published. */
  async function receive(queue: string, msg: ConsumeMessage): Promise<void> {
    deliver[queue](msg);
    await Promise.allSettled([...host['inFlight']]);
  }

  const sentTo = (queue: string) =>
    channel.sendToQueue.mock.calls.filter(([q]) => q === queue) as [
      string,
      Buffer,
      { headers: Record<string, unknown> },
    ][];

  let logError: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    deliver = {};
    let tag = 0;
    channel = {
      assertExchange: jest.fn().mockResolvedValue({}),
      assertQueue: jest.fn().mockResolvedValue({}),
      bindQueue: jest.fn().mockResolvedValue({}),
      prefetch: jest.fn().mockResolvedValue({}),
      consume: jest.fn((queue: string, cb: (m: ConsumeMessage) => void) => {
        deliver[queue] = cb;
        return Promise.resolve({ consumerTag: `tag-${++tag}` });
      }),
      cancel: jest.fn().mockResolvedValue({}),
      ack: jest.fn(),
      nack: jest.fn(),
      sendToQueue: jest.fn(
        (_q: string, _c: Buffer, _o: unknown, cb: (err: unknown) => void) => {
          cb(null);
          return true;
        },
      ),
    };
    wrapper = { close: jest.fn().mockResolvedValue(undefined) };
    connection = { createChannel: jest.fn().mockReturnValue(wrapper) };
    host = new AmqpConsumerHost(connection as unknown as AmqpConnectionManager);
    eventHandler.handle.mockReset().mockResolvedValue(undefined);
    eventHandler.onExhausted.mockReset().mockResolvedValue(undefined);
    emailHandler.handle.mockReset().mockResolvedValue(undefined);
    emailHandler.onExhausted.mockReset().mockResolvedValue(undefined);
    host.registerEventHandler(
      [RoutingKeys.POST_LIKED],
      PostLikedPayload,
      eventHandler,
    );
    host.registerEmailHandler(emailHandler);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('registration', () => {
    it('rejects routing keys that are not bound to the events queue', () => {
      expect(() =>
        host.registerEventHandler(
          [RoutingKeys.NOTIFICATION_CREATED],
          PostLikedPayload,
          eventHandler,
        ),
      ).toThrow('not bound');
    });

    it('rejects a second handler for the same key', () => {
      expect(() =>
        host.registerEventHandler(
          [RoutingKeys.POST_LIKED],
          PostLikedPayload,
          eventHandler,
        ),
      ).toThrow('already registered');
    });

    it('rejects registration after bootstrap', async () => {
      await boot();
      expect(() => host.registerEmailHandler(emailHandler)).toThrow(
        'onModuleInit',
      );
    });
  });

  it('declares the topology, then consumes both queues with their prefetch', async () => {
    await boot();

    expect(connection.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ confirm: true }),
    );
    expect(channel.assertExchange).toHaveBeenCalled();
    expect(channel.prefetch.mock.calls).toEqual([
      [20, false],
      [5, false],
    ]);
    expect(Object.keys(deliver)).toEqual([
      'notifications.events',
      'notifications.email',
    ]);
  });

  it('acks after the handler succeeds, with a validated payload instance', async () => {
    await boot();
    const msg = message(likedEnvelope);

    await receive('notifications.events', msg);

    const [envelope, ctx] = eventHandler.handle.mock.calls[0] as [
      { payload: unknown },
      unknown,
    ];
    expect(envelope.payload).toBeInstanceOf(PostLikedPayload);
    expect(ctx).toEqual({
      attempt: 1,
      maxAttempts: 5,
      isFinalAttempt: false,
      queue: 'notifications.events',
    });
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.sendToQueue).not.toHaveBeenCalled();
  });

  it('re-publishes a failed event to the retry queue with x-attempts + 1, then acks', async () => {
    await boot();
    eventHandler.handle.mockRejectedValueOnce(new Error('db down'));
    const msg = message(likedEnvelope, { [ATTEMPTS_HEADER]: 2 });

    await receive('notifications.events', msg);

    const [[, content, options]] = sentTo('notifications.events.retry');
    expect(content).toBe(msg.content);
    expect(options).toMatchObject({ persistent: true, messageId: 'm-1' });
    expect(options.headers).toMatchObject({
      [ATTEMPTS_HEADER]: 3,
      'x-last-error': 'Error: db down',
      [ORIGINAL_ROUTING_KEY_HEADER]: RoutingKeys.POST_LIKED,
    });
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(eventHandler.onExhausted).not.toHaveBeenCalled();
  });

  it('sends the 5th failed attempt to the DLQ and calls onExhausted', async () => {
    await boot();
    eventHandler.handle.mockRejectedValueOnce(new Error('still down'));
    const msg = message(
      likedEnvelope,
      {
        [ATTEMPTS_HEADER]: 5,
        [ORIGINAL_ROUTING_KEY_HEADER]: RoutingKeys.POST_LIKED,
      },
      'notifications.events',
    );

    await receive('notifications.events', msg);

    expect(sentTo('notifications.events.retry')).toHaveLength(0);
    const [[, , options]] = sentTo('notifications.events.dlq');
    expect(options.headers).toMatchObject({
      [ATTEMPTS_HEADER]: 5,
      [ORIGINAL_ROUTING_KEY_HEADER]: RoutingKeys.POST_LIKED,
    });
    expect(eventHandler.onExhausted).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(logError).toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{nope'],
    ['an invalid payload', { ...likedEnvelope, payload: { postId: 'x' } }],
    ['an unhandled type', { ...likedEnvelope, type: 'social.user.followed' }],
  ])('dead-letters %s without calling the handler', async (_, body) => {
    await boot();
    const msg = message(body);

    await receive('notifications.events', msg);

    expect(eventHandler.handle).not.toHaveBeenCalled();
    expect(sentTo('notifications.events.dlq')).toHaveLength(1);
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('dead-letters immediately when the handler throws PoisonMessageError', async () => {
    await boot();
    eventHandler.handle.mockRejectedValueOnce(new PoisonMessageError('bad'));

    await receive('notifications.events', message(likedEnvelope));

    expect(sentTo('notifications.events.retry')).toHaveLength(0);
    expect(sentTo('notifications.events.dlq')).toHaveLength(1);
  });

  it('requeues the original when the retry copy is not confirmed', async () => {
    await boot();
    eventHandler.handle.mockRejectedValueOnce(new Error('db down'));
    channel.sendToQueue.mockImplementationOnce(
      (_q: string, _c: Buffer, _o: unknown, cb: (err: unknown) => void) => {
        cb(new Error('nacked'));
        return true;
      },
    );
    const msg = message(likedEnvelope);

    await receive('notifications.events', msg);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  describe('email jobs', () => {
    it('retries a failed job on notifications.email.retry', async () => {
      await boot();
      emailHandler.handle.mockRejectedValueOnce(new Error('smtp'));

      await receive(
        'notifications.email',
        message(emailJob, {}, 'notifications.email'),
      );

      const [[, , options]] = sentTo('notifications.email.retry');
      expect(options.headers[ATTEMPTS_HEADER]).toBe(2);
    });

    it('drops the 3rd failed attempt after onExhausted (no DLQ)', async () => {
      await boot();
      emailHandler.handle.mockRejectedValueOnce(new Error('smtp'));
      const msg = message(
        emailJob,
        { [ATTEMPTS_HEADER]: 3 },
        'notifications.email',
      );

      await receive('notifications.email', msg);

      expect(channel.sendToQueue).not.toHaveBeenCalled();
      const [job, error, ctx] = emailHandler.onExhausted.mock.calls[0] as [
        unknown,
        Error,
        { isFinalAttempt: boolean },
      ];
      expect(job).toMatchObject({ jobId: emailJob.jobId });
      expect(error.message).toBe('smtp');
      expect(ctx.isFinalAttempt).toBe(true);
      expect(channel.ack).toHaveBeenCalledWith(msg);
    });
  });

  describe('shutdown', () => {
    it('cancels consumers, waits for in-flight handlers, then closes the channel', async () => {
      await boot();
      let finish!: () => void;
      eventHandler.handle.mockReturnValueOnce(
        new Promise<void>((resolve) => (finish = resolve)),
      );
      const msg = message(likedEnvelope);
      deliver['notifications.events'](msg);
      await new Promise((r) => setImmediate(r));

      const stopping = host.onModuleDestroy();
      await new Promise((r) => setImmediate(r));
      expect(channel.cancel.mock.calls).toEqual([['tag-1'], ['tag-2']]);
      expect(wrapper.close).not.toHaveBeenCalled();

      finish();
      await stopping;
      expect(channel.ack).toHaveBeenCalledWith(msg);
      expect(wrapper.close).toHaveBeenCalledTimes(1);
    });

    it('does not consume again when the channel reconnects while stopping', async () => {
      await boot();
      await host.onModuleDestroy();
      channel.consume.mockClear();

      const [{ setup }] = connection.createChannel.mock.calls[0] as [
        { setup: (ch: ConfirmChannel) => Promise<void> },
      ];
      await setup(channel as unknown as ConfirmChannel);

      expect(channel.consume).not.toHaveBeenCalled();
    });
  });
});
