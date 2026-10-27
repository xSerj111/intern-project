import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertInternalApiToken } from '@repo/shared';

/**
 * Typed application configuration, backed by `@nestjs/config`'s ConfigService.
 * The single place the running app reads environment-derived settings. Startup
 * validation (`env.validation.ts`) guarantees required variables exist; required
 * settings use `getOrThrow`, optional ones `get` with their default.
 */
@Injectable()
export class AppConfigService implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  /** Fail fast at bootstrap: a missing or short INTERNAL_API_TOKEN stops the service. */
  onModuleInit(): void {
    void this.internalApiToken;
  }

  /** HTTP port the Notifications service listens on. */
  get port(): number {
    // Own variable, not the shared PORT: every service reads the same root
    // config file, so a single PORT makes two services fight over one socket.
    return Number(this.config.get<string | number>('NOTIFICATIONS_PORT', 3003));
  }

  /** Postgres connection settings for the Notifications database. */
  get postgres() {
    return {
      type: 'postgres' as const,
      host: this.config.get<string>('POSTGRES_HOST', 'localhost'),
      port: Number(this.config.get<string | number>('POSTGRES_PORT', 5432)),
      username: this.config.get<string>('POSTGRES_USER', 'postgres'),
      password: this.config.get<string>('POSTGRES_PASSWORD', 'postgres'),
      database: this.config.get<string>(
        'DB_NAME_NOTIFICATIONS',
        'innogram_notifications',
      ),
      synchronize: false, // Strict migrations mode
    };
  }

  /** RabbitMQ (AMQP) connection settings for the realtime event bus. */
  get rabbitmq() {
    return {
      url: this.config.getOrThrow<string>('RABBITMQ_URL'),
    };
  }

  /** Redis connection settings (access-token blacklist shared with auth/core). */
  get redis() {
    return {
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: Number(this.config.get<string | number>('REDIS_PORT', 6379)),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
    };
  }

  /** Secret used to verify access-token JWTs issued by auth. */
  get jwtSecret(): string {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  /** Shared secret for service-to-service calls to auth's internal API. */
  get internalApiToken(): string {
    // Same floor (32 chars) as auth's own check, via the shared assertion.
    const token = this.config.get<string>('INTERNAL_API_TOKEN');
    assertInternalApiToken(token);
    return token;
  }

  /** Base URL of auth's internal (non-public) HTTP API. */
  get authInternalUrl(): string {
    return this.config.getOrThrow<string>('AUTH_INTERNAL_URL');
  }

  /** Origin of the web client; used for CORS and links in emails. */
  get clientUrl(): string {
    return this.config.getOrThrow<string>('CLIENT_URL');
  }

  /** SMTP transport settings for email delivery. */
  get smtp() {
    return {
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: Number(this.config.getOrThrow<string | number>('SMTP_PORT')),
      secure:
        this.config.getOrThrow<string>('SMTP_SECURE').toLowerCase() === 'true',
      from: this.config.getOrThrow<string>('SMTP_FROM'),
      // Optional: the local Mailpit container accepts unauthenticated mail.
      user: this.config.get<string>('SMTP_USER') || undefined,
      pass: this.config.get<string>('SMTP_PASS') || undefined,
    };
  }
}
