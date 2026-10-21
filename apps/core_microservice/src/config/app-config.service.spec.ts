import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';

const build = (env: Record<string, string | undefined> = {}) =>
  new AppConfigService({
    get: (key: string, fallback?: string) => env[key] ?? fallback,
  } as unknown as ConfigService);

describe('AppConfigService', () => {
  describe('defaults', () => {
    const service = build();

    it('disables perf instrumentation', () => {
      expect(service.perfInstrumentation).toBe(false);
    });

    it('uses 200ms slow query threshold', () => {
      expect(service.slowQueryMs).toBe(200);
    });

    it('points the cache at localhost:6380', () => {
      expect(service.cacheRedis).toEqual({ host: 'localhost', port: 6380 });
    });

    it('uses default upload timings', () => {
      expect(service.uploads).toEqual({
        linkTtlSec: 300,
        sweepGraceSec: 3600,
        sweepIntervalSec: 900,
      });
    });

    it('leaves internalApiToken undefined', () => {
      expect(service.internalApiToken).toBeUndefined();
    });
  });

  describe('parsing', () => {
    it('enables perf instrumentation only for the exact string "true"', () => {
      expect(build({ PERF_INSTRUMENTATION: 'true' }).perfInstrumentation).toBe(
        true,
      );
      expect(build({ PERF_INSTRUMENTATION: '1' }).perfInstrumentation).toBe(
        false,
      );
    });

    it('parses numeric overrides', () => {
      const service = build({
        SLOW_QUERY_MS: '50',
        CACHE_REDIS_HOST: 'cache',
        CACHE_REDIS_PORT: '6390',
        UPLOAD_LINK_TTL_SEC: '5',
        UPLOAD_SWEEP_GRACE_SEC: '10',
        UPLOAD_SWEEP_INTERVAL_SEC: '2',
      });

      expect(service.slowQueryMs).toBe(50);
      expect(service.cacheRedis).toEqual({ host: 'cache', port: 6390 });
      expect(service.uploads).toEqual({
        linkTtlSec: 5,
        sweepGraceSec: 10,
        sweepIntervalSec: 2,
      });
    });

    it('rejects non-integer numeric values', () => {
      expect(() => build({ SLOW_QUERY_MS: 'abc' }).slowQueryMs).toThrow(
        'SLOW_QUERY_MS must be a positive integer',
      );
    });

    it('returns the raw internal token', () => {
      expect(build({ INTERNAL_API_TOKEN: 'short' }).internalApiToken).toBe(
        'short',
      );
    });
  });

  describe('assertInternalApiToken', () => {
    it('throws when the token is unset', () => {
      expect(() => build().assertInternalApiToken()).toThrow(
        /INTERNAL_API_TOKEN/,
      );
    });

    it('throws when the token is shorter than 32 characters', () => {
      const service = build({ INTERNAL_API_TOKEN: 'x'.repeat(31) });

      expect(() => service.assertInternalApiToken()).toThrow(
        /at least 32 characters/,
      );
    });

    it('accepts a token of 32 characters or more', () => {
      const service = build({ INTERNAL_API_TOKEN: 'x'.repeat(32) });

      expect(() => service.assertInternalApiToken()).not.toThrow();
    });
  });

  describe('assertSafeForEnvironment', () => {
    it('throws when instrumentation is on in production', () => {
      const service = build({
        PERF_INSTRUMENTATION: 'true',
        NODE_ENV: 'production',
      });

      expect(() => service.assertSafeForEnvironment()).toThrow(
        /PERF_INSTRUMENTATION.*NODE_ENV=production/,
      );
    });

    it('allows instrumentation outside production', () => {
      const service = build({
        PERF_INSTRUMENTATION: 'true',
        NODE_ENV: 'development',
      });

      expect(() => service.assertSafeForEnvironment()).not.toThrow();
    });

    it('allows production with instrumentation off', () => {
      const service = build({ NODE_ENV: 'production' });

      expect(() => service.assertSafeForEnvironment()).not.toThrow();
    });
  });
});
