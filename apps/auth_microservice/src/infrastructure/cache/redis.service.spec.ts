import type { Redis } from 'ioredis';
import type { WinstonLogger } from '@repo/shared';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let client: {
    on: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    exists: jest.Mock;
  };
  let logger: { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let service: RedisService;

  const handler = (event: string): ((...args: unknown[]) => void) => {
    const call = client.on.mock.calls.find(([name]) => name === event) as
      [string, (...args: unknown[]) => void] | undefined;
    if (!call) throw new Error(`no handler for ${event}`);
    return call[1];
  };

  beforeEach(() => {
    client = {
      on: jest.fn(),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn(),
      exists: jest.fn(),
    };
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new RedisService(
      client as unknown as Redis,
      logger as unknown as WinstonLogger,
    );
  });

  it('registers connect, error and reconnecting handlers that log', () => {
    expect(client.on).toHaveBeenCalledTimes(3);

    handler('connect')();
    expect(logger.info).toHaveBeenCalledWith('Redis connected');

    const err = new Error('boom');
    handler('error')(err);
    expect(logger.error).toHaveBeenCalledWith('Redis error', { error: err });

    handler('reconnecting')();
    expect(logger.warn).toHaveBeenCalledWith('Redis reconnecting...');
  });

  it('get returns the stored value or null', async () => {
    client.get.mockResolvedValueOnce('v').mockResolvedValueOnce(null);

    await expect(service.get('k')).resolves.toBe('v');
    await expect(service.get('missing')).resolves.toBeNull();
    expect(client.get).toHaveBeenCalledWith('k');
  });

  it('setWithExpiry stores the value with an EX ttl', async () => {
    await service.setWithExpiry('k', 'v', 60);

    expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 60);
  });

  it('delete returns the number of removed keys', async () => {
    client.del.mockResolvedValue(1);

    await expect(service.delete('k')).resolves.toBe(1);
    expect(client.del).toHaveBeenCalledWith('k');
  });

  it('has is true only when exists returns 1', async () => {
    client.exists.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(service.has('k')).resolves.toBe(true);
    await expect(service.has('k')).resolves.toBe(false);
  });

  describe('getOrSet', () => {
    it('returns the cached value without calling the factory', async () => {
      client.get.mockResolvedValue('cached');
      const factory = jest.fn();

      await expect(service.getOrSet('k', factory, 30)).resolves.toBe('cached');
      expect(factory).not.toHaveBeenCalled();
      expect(client.set).not.toHaveBeenCalled();
    });

    it('treats an empty string as a cache hit', async () => {
      client.get.mockResolvedValue('');
      const factory = jest.fn();

      await expect(service.getOrSet('k', factory, 30)).resolves.toBe('');
      expect(factory).not.toHaveBeenCalled();
    });

    it('computes, stores with ttl and returns the value on a miss', async () => {
      client.get.mockResolvedValue(null);
      const factory = jest.fn().mockResolvedValue('fresh');

      await expect(service.getOrSet('k', factory, 30)).resolves.toBe('fresh');
      expect(client.set).toHaveBeenCalledWith('k', 'fresh', 'EX', 30);
    });

    it('does not store anything when the factory rejects', async () => {
      client.get.mockResolvedValue(null);
      const factory = jest.fn().mockRejectedValue(new Error('factory failed'));

      await expect(service.getOrSet('k', factory, 30)).rejects.toThrow('factory failed');
      expect(client.set).not.toHaveBeenCalled();
    });
  });
});
