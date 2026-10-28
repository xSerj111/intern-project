import type Redis from 'ioredis';
import { SessionRedisCheck } from './session-redis.check';

describe('SessionRedisCheck', () => {
  const ping = jest.fn();
  const check = new SessionRedisCheck({ ping } as unknown as Redis);

  beforeEach(() => jest.resetAllMocks());

  it('is a critical check named session_redis', () => {
    expect(check.name).toBe('session_redis');
    expect(check.critical).toBe(true);
  });

  it('resolves when PING answers', async () => {
    ping.mockResolvedValue('PONG');

    await expect(check.run()).resolves.toBeUndefined();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('rejects when PING fails', async () => {
    ping.mockRejectedValue(new Error('Connection is closed.'));

    await expect(check.run()).rejects.toThrow('Connection is closed.');
  });

  it('propagates a command timeout', async () => {
    ping.mockRejectedValue(new Error('Command timed out'));

    await expect(check.run()).rejects.toThrow('Command timed out');
  });
});
