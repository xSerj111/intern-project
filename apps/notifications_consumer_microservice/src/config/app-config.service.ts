import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Typed application configuration, backed by `@nestjs/config`'s ConfigService.
 * The single place the running app reads environment-derived settings. Required
 * settings use `getOrThrow`, so a missing variable fails fast at first read.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  /** HTTP port the Notifications service listens on. */
  get port(): number {
    // Own variable, not the shared PORT: every service reads the same root
    // config file, so a single PORT makes two services fight over one socket.
    return parseInt(this.config.get<string>('NOTIFICATIONS_PORT', '3003'), 10);
  }

  /** Postgres connection settings for the Notifications database. */
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
      database: this.config.getOrThrow<string>(
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
      port: parseInt(this.config.get<string>('REDIS_PORT', '6379'), 10),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
    };
  }

  /** Secret used to verify access-token JWTs issued by auth. */
  get jwtSecret(): string {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  /** Shared secret for service-to-service calls to auth's internal API. */
  get internalApiToken(): string {
    return this.config.getOrThrow<string>('INTERNAL_API_TOKEN');
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
    const port = Number(this.config.getOrThrow<string>('SMTP_PORT'));

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('SMTP_PORT must be a valid port number');
    }

    return {
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port,
      secure:
        this.config.getOrThrow<string>('SMTP_SECURE').toLowerCase() === 'true',
      from: this.config.getOrThrow<string>('SMTP_FROM'),
      // Optional: the local Mailpit container accepts unauthenticated mail.
      user: this.config.get<string>('SMTP_USER') || undefined,
      pass: this.config.get<string>('SMTP_PASS') || undefined,
    };
  }
}
