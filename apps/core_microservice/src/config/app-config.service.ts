import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertInternalApiToken } from '@repo/shared';

/**
 * Typed application configuration, backed by `@nestjs/config`'s ConfigService.
 * The single place the running app reads environment-derived settings, so call
 * sites depend on typed getters instead of raw `process.env`.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  /** HTTP port the Core service listens on. */
  get port(): number {
    // Own variable, not the shared PORT: every service reads the same root
    // config file, so a single PORT makes two services fight over one socket.
    return parseInt(this.config.get<string>('CORE_PORT', '3001'), 10);
  }

  /** Postgres connection settings for the Core database. */
  get postgres() {
    return {
      type: 'postgres' as const,
      host: this.config.getOrThrow<string>('POSTGRES_HOST', 'localhost'),
      port: parseInt(
        this.config.getOrThrow<string>('POSTGRES_PORT', '5432'),
        10,
      ),
      username: this.config.getOrThrow<string>('POSTGRES_USER', 'postgres'),
      password: this.config.getOrThrow<string>('POSTGRES_PASSWORD', 'postgres'),
      database: this.config.getOrThrow<string>('DB_NAME_CORE', 'innogram_core'),
      synchronize: false, // Strict migrations mode
    };
  }

  /** Redis connection settings (shared with auth_microservice's token blacklist). */
  get redis() {
    return {
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: parseInt(this.config.get<string>('REDIS_PORT', '6379'), 10),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
    };
  }

  /** RabbitMQ (AMQP) connection settings for the realtime event bus. */
  get rabbitmq() {
    return {
      url: this.config.getOrThrow<string>('RABBITMQ_URL'),
    };
  }

  /** Outbox relay settings. */
  get outbox() {
    const maxAttempts = Number(
      this.config.get<string>('OUTBOX_MAX_ATTEMPTS', '10'),
    );

    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('OUTBOX_MAX_ATTEMPTS must be a positive integer');
    }

    // Failed publishes after which the relay dead-letters a row (skips it).
    return { maxAttempts };
  }

  get s3() {
    const port = Number(this.config.get<string>('S3_PORT', '9000'));

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('S3_PORT must be a valid port number');
    }

    const endpoint = this.config.getOrThrow<string>('S3_ENDPOINT');

    return {
      endpoint,
      port,
      accessKey: this.config.getOrThrow<string>('S3_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('S3_SECRET_KEY'),
      bucketName: this.config.get<string>('S3_BUCKET_NAME', 'innogram-assets'),
      privateBucket: this.config.getOrThrow<string>('S3_PRIVATE_BUCKET_NAME'),
      // Host used to sign browser-facing URLs; empty counts as unset.
      publicEndpoint: this.config.get<string>('S3_PUBLIC_ENDPOINT') || endpoint,
      region: this.config.get<string>('S3_REGION', 'us-east-1'),
      useSsl:
        this.config.get<string>('S3_USE_SSL', 'false').toLowerCase() === 'true',
    };
  }

  /** Enables per-request SQL counting (`X-Db-Query-Count`); never allowed in production. */
  get perfInstrumentation(): boolean {
    return this.config.get<string>('PERF_INSTRUMENTATION') === 'true';
  }

  /** Queries slower than this many milliseconds are logged as slow. */
  get slowQueryMs(): number {
    return this.positiveInt('SLOW_QUERY_MS', 200);
  }

  /** Connection settings for the separate cache Redis instance. */
  get cacheRedis() {
    return {
      host: this.config.get<string>('CACHE_REDIS_HOST') || 'localhost',
      port: this.positiveInt('CACHE_REDIS_PORT', 6380),
    };
  }

  /** Upload-link lifetime and orphan-sweep timings, in seconds. */
  get uploads() {
    return {
      linkTtlSec: this.positiveInt('UPLOAD_LINK_TTL_SEC', 300),
      sweepGraceSec: this.positiveInt('UPLOAD_SWEEP_GRACE_SEC', 3600),
      sweepIntervalSec: this.positiveInt('UPLOAD_SWEEP_INTERVAL_SEC', 900),
    };
  }

  /** Raw shared token for internal endpoints; length validation is added separately. */
  get internalApiToken(): string | undefined {
    return this.config.get<string>('INTERNAL_API_TOKEN') || undefined;
  }

  /** Fails fast unless `INTERNAL_API_TOKEN` is set and at least 32 chars; called during bootstrap. */
  assertInternalApiToken(): void {
    assertInternalApiToken(this.internalApiToken);
  }

  /**
   * Fails fast on unsafe configuration; called during bootstrap.
   * Query-count instrumentation must never run in production.
   */
  assertSafeForEnvironment(): void {
    if (
      this.perfInstrumentation &&
      this.config.get<string>('NODE_ENV') === 'production'
    ) {
      throw new Error(
        'PERF_INSTRUMENTATION=true is not allowed when NODE_ENV=production',
      );
    }
  }

  private positiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === '') return fallback;

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${key} must be a positive integer`);
    }
    return value;
  }
}
