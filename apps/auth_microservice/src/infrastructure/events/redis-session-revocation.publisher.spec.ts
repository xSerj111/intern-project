import { RedisKeys, SessionRevokedEvent, WinstonLogger } from '@repo/shared';
import { Redis } from 'ioredis';
import { RedisSessionRevocationPublisher } from './redis-session-revocation.publisher';

describe('RedisSessionRevocationPublisher', () => {
  const event: SessionRevokedEvent = {
    userId: 'user-1',
    sid: 'sid-1',
    jti: 'jti-1',
    revokedAt: '2026-01-01T00:00:00.000Z',
  };

  let client: { publish: jest.Mock };
  let logger: { error: jest.Mock };
  let publisher: RedisSessionRevocationPublisher;

  beforeEach(() => {
    client = { publish: jest.fn().mockResolvedValue(1) };
    logger = { error: jest.fn() };
    publisher = new RedisSessionRevocationPublisher(
      client as unknown as Redis,
      logger as unknown as WinstonLogger,
    );
  });

  it('publishes the event as JSON on the session-revoked channel', async () => {
    await publisher.publish(event);

    expect(client.publish).toHaveBeenCalledTimes(1);
    const [channel, message] = client.publish.mock.calls[0] as [string, string];
    expect(channel).toBe(RedisKeys.sessionRevokedChannel);
    expect(channel).toBe('auth:session-revoked');
    expect(JSON.parse(message)).toEqual(event);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('swallows and logs a Redis failure', async () => {
    const error = new Error('connection lost');
    client.publish.mockRejectedValue(error);

    await expect(publisher.publish(event)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith('Failed to publish session revocation', {
      error,
    });
  });
});
