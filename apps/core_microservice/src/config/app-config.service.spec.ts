import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';

const build = (env: Record<string, string | undefined> = {}) =>
  new AppConfigService({
    get: (key: string, fallback?: string) => env[key] ?? fallback,
    getOrThrow: (key: string, fallback?: string) => {
      const value = env[key] ?? fallback;
      if (value === undefined) throw new Error(`${key} is required`);
      return value;
    },
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

    it('defaults the client origin and treats an empty CLIENT_URL as unset', () => {
      expect(service.clientUrl).toBe('http://localhost:3000');
      expect(build({ CLIENT_URL: '' }).clientUrl).toBe('http://localhost:3000');
      expect(build({ CLIENT_URL: 'https://app.test' }).clientUrl).toBe(
        'https://app.test',
      );
    });

    it('requires JWT_SECRET', () => {
      expect(() => service.jwtSecret).toThrow('JWT_SECRET');
      expect(build({ JWT_SECRET: 's' }).jwtSecret).toBe('s');
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

    it.each(['0', '-3', '1.5', 'abc'])('rejects SLOW_QUERY_MS=%s', (value) => {
      expect(() => build({ SLOW_QUERY_MS: value }).slowQueryMs).toThrow(
        'SLOW_QUERY_MS must be a positive integer',
      );
    });

    it('accepts 0 for UPLOAD_SWEEP_GRACE_SEC', () => {
      expect(build({ UPLOAD_SWEEP_GRACE_SEC: '0' }).uploads.sweepGraceSec).toBe(
        0,
      );
    });

    it('rejects a negative UPLOAD_SWEEP_GRACE_SEC', () => {
      expect(() => build({ UPLOAD_SWEEP_GRACE_SEC: '-1' }).uploads).toThrow(
        'UPLOAD_SWEEP_GRACE_SEC must be a non-negative integer',
      );
    });

    it('treats an empty numeric value as unset', () => {
      expect(build({ SLOW_QUERY_MS: '' }).slowQueryMs).toBe(200);
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

  describe('swaggerEnabled', () => {
    it('is on by default and when NODE_ENV is not production', () => {
      expect(build().swaggerEnabled).toBe(true);
      expect(build({ NODE_ENV: 'development' }).swaggerEnabled).toBe(true);
    });

    it('is off by default in production, empty counts as unset', () => {
      expect(build({ NODE_ENV: 'production' }).swaggerEnabled).toBe(false);
      expect(
        build({ NODE_ENV: 'production', SWAGGER_ENABLED: '' }).swaggerEnabled,
      ).toBe(false);
    });

    it('lets SWAGGER_ENABLED override the default either way', () => {
      expect(
        build({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })
          .swaggerEnabled,
      ).toBe(true);
      expect(
        build({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' })
          .swaggerEnabled,
      ).toBe(false);
    });
  });

  describe('port', () => {
    it('defaults to 3001', () => {
      expect(build().port).toBe(3001);
    });

    it('reads CORE_PORT, not the shared PORT', () => {
      expect(build({ CORE_PORT: '4001', PORT: '9999' }).port).toBe(4001);
    });
  });

  describe('postgres', () => {
    it('uses local defaults and never synchronizes', () => {
      expect(build().postgres).toEqual({
        type: 'postgres',
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'postgres',
        database: 'innogram_core',
        synchronize: false,
      });
    });

    it('parses the overrides', () => {
      expect(
        build({
          POSTGRES_HOST: 'db',
          POSTGRES_PORT: '6543',
          POSTGRES_USER: 'u',
          POSTGRES_PASSWORD: 'p',
          DB_NAME_CORE: 'core_x',
        }).postgres,
      ).toMatchObject({
        host: 'db',
        port: 6543,
        username: 'u',
        password: 'p',
        database: 'core_x',
      });
    });
  });

  describe('redis', () => {
    it('defaults to localhost:6379 without a password', () => {
      expect(build().redis).toEqual({
        host: 'localhost',
        port: 6379,
        password: undefined,
      });
    });

    it('reads the overrides and treats an empty password as unset', () => {
      expect(
        build({ REDIS_HOST: 'r', REDIS_PORT: '6400', REDIS_PASSWORD: 'pw' })
          .redis,
      ).toEqual({ host: 'r', port: 6400, password: 'pw' });
      expect(build({ REDIS_PASSWORD: '' }).redis.password).toBeUndefined();
    });
  });

  describe('rabbitmq', () => {
    it('returns the configured url', () => {
      expect(build({ RABBITMQ_URL: 'amqp://mq' }).rabbitmq).toEqual({
        url: 'amqp://mq',
      });
    });

    it('throws when RABBITMQ_URL is missing', () => {
      expect(() => build().rabbitmq).toThrow('RABBITMQ_URL');
    });
  });

  describe('outbox', () => {
    it('defaults to 10 attempts', () => {
      expect(build().outbox).toEqual({ maxAttempts: 10 });
    });

    it('parses OUTBOX_MAX_ATTEMPTS', () => {
      expect(build({ OUTBOX_MAX_ATTEMPTS: '3' }).outbox.maxAttempts).toBe(3);
    });

    it.each(['0', '-1', '1.5', 'abc'])(
      'rejects OUTBOX_MAX_ATTEMPTS=%s',
      (value) => {
        expect(() => build({ OUTBOX_MAX_ATTEMPTS: value }).outbox).toThrow(
          'OUTBOX_MAX_ATTEMPTS must be a positive integer',
        );
      },
    );
  });

  describe('s3', () => {
    const required = {
      S3_ENDPOINT: 'seaweed',
      S3_ACCESS_KEY: 'ak',
      S3_SECRET_KEY: 'sk',
      S3_PRIVATE_BUCKET_NAME: 'private',
    };

    it('applies defaults around the required settings', () => {
      expect(build(required).s3).toEqual({
        endpoint: 'seaweed',
        port: 9000,
        accessKey: 'ak',
        secretKey: 'sk',
        bucketName: 'innogram-assets',
        privateBucket: 'private',
        publicEndpoint: 'seaweed',
        region: 'us-east-1',
        useSsl: false,
      });
    });

    it('uses the public endpoint when set, and ignores an empty one', () => {
      expect(
        build({ ...required, S3_PUBLIC_ENDPOINT: 'cdn.example' }).s3
          .publicEndpoint,
      ).toBe('cdn.example');
      expect(
        build({ ...required, S3_PUBLIC_ENDPOINT: '' }).s3.publicEndpoint,
      ).toBe('seaweed');
    });

    it('parses overrides and enables SSL case-insensitively', () => {
      const s3 = build({
        ...required,
        S3_PORT: '9100',
        S3_BUCKET_NAME: 'b',
        S3_REGION: 'eu-1',
        S3_USE_SSL: 'TRUE',
      }).s3;

      expect(s3).toMatchObject({
        port: 9100,
        bucketName: 'b',
        region: 'eu-1',
        useSsl: true,
      });
    });

    it.each(['0', '65536', '-5', '90.5', 'abc'])(
      'rejects S3_PORT=%s',
      (value) => {
        expect(() => build({ ...required, S3_PORT: value }).s3).toThrow(
          'S3_PORT must be a valid port number',
        );
      },
    );

    it.each(Object.keys(required))('throws when %s is missing', (key) => {
      const env: Record<string, string> = { ...required };
      delete env[key];

      expect(() => build(env).s3).toThrow(key);
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
