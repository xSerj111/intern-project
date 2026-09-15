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

  get s3() {
    const port = Number(this.config.get<string>('S3_PORT', '9000'));

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('S3_PORT must be a valid port number');
    }

    return {
      endpoint: this.config.getOrThrow<string>('S3_ENDPOINT'),
      port,
      accessKey: this.config.getOrThrow<string>('S3_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('S3_SECRET_KEY'),
      bucketName: this.config.get<string>('S3_BUCKET_NAME', 'innogram-assets'),
      region: this.config.get<string>('S3_REGION', 'us-east-1'),
      useSsl:
        this.config.get<string>('S3_USE_SSL', 'false').toLowerCase() === 'true',
    };
  }
}
