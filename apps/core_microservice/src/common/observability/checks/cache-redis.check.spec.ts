import type Redis from 'ioredis';
import { CacheRedisCheck } from './cache-redis.check';

describe('CacheRedisCheck', () => {
  const ping = jest.fn();
  const client = { status: 'ready', ping };
  const check = new CacheRedisCheck(client as unknown as Redis);

  beforeEach(() => {
    jest.resetAllMocks();
    client.status = 'ready';
  });

  it('is a non-critical check named cache_redis', () => {
    expect(check.name).toBe('cache_redis');
    expect(check.critical).toBe(false);
  });

  it('resolves when the client is ready and PING answers', async () => {
    ping.mockResolvedValue('PONG');

    await expect(check.run()).resolves.toBeUndefined();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it.each(['connecting', 'reconnecting', 'end', 'wait'])(
    'reports not ready without sending a command while %s',
    async (status) => {
      client.status = status;

      await expect(check.run()).rejects.toThrow('not ready');
      expect(ping).not.toHaveBeenCalled();
    },
  );

  it('rejects when PING throws on a ready client', async () => {
    ping.mockRejectedValue(new Error('Command timed out'));

    await expect(check.run()).rejects.toThrow('Command timed out');
  });
});
