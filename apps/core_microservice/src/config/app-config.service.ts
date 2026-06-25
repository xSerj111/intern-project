import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
    return parseInt(this.config.get<string>('PORT', '3002'), 10);
  }

  /** Postgres connection settings for the Core database. */
  get postgres() {
    return {
      type: 'postgres' as const,
      host: this.config.getOrThrow<string>('POSTGRES_HOST', 'localhost'),
      port: parseInt(this.config.getOrThrow<string>('POSTGRES_PORT', '5432'), 10),
      username: this.config.getOrThrow<string>('POSTGRES_USER', 'postgres'),
      password: this.config.getOrThrow<string>('POSTGRES_PASSWORD', 'postgres'),
      database: this.config.getOrThrow<string>('DB_NAME_CORE', 'innogram_core'),
      synchronize: false, // Strict migrations mode
    };
  }
}
