import { EXCHANGE_NAME, RoutingKeys } from '@repo/shared';
import {
  assertNotificationsTopology,
  EMAIL_QUEUE,
  EVENTS_QUEUE,
  topicMatches,
} from './amqp-topology';

describe('assertNotificationsTopology', () => {
  const channel = {
    assertExchange: jest.fn().mockResolvedValue({}),
    assertQueue: jest.fn().mockResolvedValue({}),
    bindQueue: jest.fn().mockResolvedValue({}),
  };

  beforeAll(() => assertNotificationsTopology(channel));

  it('declares the durable topic exchange', () => {
    expect(channel.assertExchange).toHaveBeenCalledWith(
      EXCHANGE_NAME,
      'topic',
      {
        durable: true,
      },
    );
  });

  it('declares durable main queues and the events DLQ', () => {
    for (const name of [
      'notifications.events',
      'notifications.events.dlq',
      'notifications.email',
    ]) {
      expect(channel.assertQueue).toHaveBeenCalledWith(name, { durable: true });
    }
    expect(channel.assertQueue).not.toHaveBeenCalledWith(
      'notifications.email.dlq',
      expect.anything(),
    );
  });

  it.each([
    ['notifications.events.retry', 10_000, 'notifications.events'],
    ['notifications.email.retry', 30_000, 'notifications.email'],
  ])('%s holds for %i ms then dead-letters back to %s', (retry, ttl, main) => {
    expect(channel.assertQueue).toHaveBeenCalledWith(retry, {
      durable: true,
      messageTtl: ttl,
      deadLetterExchange: '',
      deadLetterRoutingKey: main,
    });
  });

  it('binds the events queue to social.# and chat.message.alerted only', () => {
    expect(channel.bindQueue.mock.calls).toEqual([
      ['notifications.events', EXCHANGE_NAME, 'social.#'],
      ['notifications.events', EXCHANGE_NAME, RoutingKeys.CHAT_MESSAGE_ALERTED],
    ]);
  });

  it('uses the documented attempt limits and prefetch', () => {
    expect(EVENTS_QUEUE).toMatchObject({ maxAttempts: 5, prefetch: 20 });
    expect(EMAIL_QUEUE).toMatchObject({
      maxAttempts: 3,
      deadLetterQueue: null,
    });
  });
});

describe('topicMatches', () => {
  it.each([
    ['social.#', 'social.post.liked', true],
    ['social.#', 'social', true],
    ['social.#', 'chat.message.alerted', false],
    ['chat.message.alerted', 'chat.message.alerted', true],
    ['chat.*', 'chat.message.alerted', false],
    ['chat.*.alerted', 'chat.message.alerted', true],
    ['#', 'notification.created', true],
  ])('%s vs %s -> %p', (pattern, key, expected) => {
    expect(topicMatches(pattern, key)).toBe(expected);
  });
});
