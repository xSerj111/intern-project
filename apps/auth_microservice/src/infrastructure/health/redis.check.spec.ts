import type { Redis } from 'ioredis';
import { createRedisCheck } from './redis.check';

describe('createRedisCheck', () => {
  it('is a critical check named redis', () => {
    const check = createRedisCheck({ ping: jest.fn() } as unknown as Redis);

    expect(check.name).toBe('redis');
    expect(check.critical).toBe(true);
  });

  it('pings the client', async () => {
    const ping = jest.fn().mockResolvedValue('PONG');
    const check = createRedisCheck({ ping } as unknown as Redis);

    await expect(check.run()).resolves.toBeUndefined();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('propagates a ping failure', async () => {
    const ping = jest.fn().mockRejectedValue(new Error('down'));
    const check = createRedisCheck({ ping } as unknown as Redis);

    await expect(check.run()).rejects.toThrow('down');
  });
});
