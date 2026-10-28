import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { Registry } from 'prom-client';
import { countsKey, profileKey, signedUrlKey } from './cache-keys';
import { RedisCacheAdapter } from './redis-cache.adapter';

describe('RedisCacheAdapter', () => {
  let client: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let registry: Registry;
  let adapter: RedisCacheAdapter;
  let warn: jest.SpyInstance;

  const counterValue = async (
    resource: string,
    result: string,
  ): Promise<number> => {
    const metric = await registry
      .getSingleMetric('cache_requests_total')!
      .get();
    return (
      metric.values.find(
        (v) => v.labels.resource === resource && v.labels.result === result,
      )?.value ?? 0
    );
  };

  beforeEach(() => {
    client = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    registry = new Registry();
    adapter = new RedisCacheAdapter(client as unknown as Redis, registry);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('get', () => {
    it('returns the JSON-decoded value on a hit and records a hit', async () => {
      client.get.mockResolvedValue(JSON.stringify({ a: 1, b: 'x' }));

      await expect(adapter.get(profileKey('u1'))).resolves.toEqual({
        a: 1,
        b: 'x',
      });
      expect(client.get).toHaveBeenCalledWith('cache:v1:profile:u1');
      expect(await counterValue('profile', 'hit')).toBe(1);
    });

    it('returns null on a miss and records a miss', async () => {
      client.get.mockResolvedValue(null);

      await expect(adapter.get(countsKey('u1'))).resolves.toBeNull();
      expect(await counterValue('follow_counts', 'miss')).toBe(1);
    });

    it('fails open on a rejected command: null, error metric, warn without the value', async () => {
      client.get.mockRejectedValue(new Error('Command timed out'));

      await expect(adapter.get(profileKey('u1'))).resolves.toBeNull();
      expect(await counterValue('profile', 'error')).toBe(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String((warn.mock.calls as unknown[][])[0][0])).toContain(
        'Command timed out',
      );
    });

    it('treats an undecodable value as an error, not a hit', async () => {
      client.get.mockResolvedValue('{not json');

      await expect(adapter.get(profileKey('u1'))).resolves.toBeNull();
      expect(await counterValue('profile', 'error')).toBe(1);
    });

    it('rate-limits the warn log', async () => {
      client.get.mockRejectedValue(new Error('down'));
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

      await adapter.get(profileKey('u1'));
      await adapter.get(profileKey('u2'));
      await adapter.get(profileKey('u3'));
      expect(warn).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 60_000);
      await adapter.get(profileKey('u4'));
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String((warn.mock.calls as unknown[][])[1][0])).toContain(
        '2 suppressed',
      );
      expect(await counterValue('profile', 'error')).toBe(4);
    });
  });

  describe('set', () => {
    it('JSON-encodes the value and always sets EX with the integer TTL', async () => {
      await adapter.set(signedUrlKey('a1', 'inline'), { url: 'u' }, 450);

      expect(client.set).toHaveBeenCalledWith(
        signedUrlKey('a1', 'inline'),
        JSON.stringify({ url: 'u' }),
        'EX',
        450,
      );
    });

    it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'throws on an invalid TTL (%p) without touching the store',
      async (ttl) => {
        await expect(adapter.set(profileKey('u1'), {}, ttl)).rejects.toThrow(
          RangeError,
        );
        expect(client.set).not.toHaveBeenCalled();
      },
    );

    it('fails open on a rejected command and never logs the value', async () => {
      client.set.mockRejectedValue(new Error('Stream not writeable'));

      await expect(
        adapter.set(profileKey('u1'), { secret: 'VALUE-123' }, 60),
      ).resolves.toBeUndefined();
      expect(await counterValue('profile', 'error')).toBe(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('VALUE-123');
    });
  });

  describe('del', () => {
    it('deletes all keys in one command', async () => {
      await adapter.del(countsKey('a'), countsKey('b'));
      expect(client.del).toHaveBeenCalledWith(
        'cache:v1:counts:a',
        'cache:v1:counts:b',
      );
    });

    it('is a no-op for no keys', async () => {
      await adapter.del();
      expect(client.del).not.toHaveBeenCalled();
    });

    it('fails open on a rejected command', async () => {
      client.del.mockRejectedValue(new Error('down'));

      await expect(adapter.del(countsKey('a'))).resolves.toBeUndefined();
      expect(await counterValue('follow_counts', 'error')).toBe(1);
    });
  });

  it('reuses an already registered counter', () => {
    expect(
      () => new RedisCacheAdapter(client as unknown as Redis, registry),
    ).not.toThrow();
  });
});
