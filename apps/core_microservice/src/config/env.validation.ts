import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Environment contract of the Core service. A variable without `@IsOptional()`
 * is required (no default exists in `AppConfigService`); an optional one falls
 * back to the default declared there. Numbers are checked after implicit
 * conversion, booleans stay strings (`'false'` must never become `true`).
 */
export class EnvironmentVariables {
  // ---- required ----------------------------------------------------------
  @IsString()
  @IsNotEmpty()
  RABBITMQ_URL!: string;

  @IsString()
  @IsNotEmpty()
  S3_ENDPOINT!: string;

  @IsString()
  @IsNotEmpty()
  S3_ACCESS_KEY!: string;

  @IsString()
  @IsNotEmpty()
  S3_SECRET_KEY!: string;

  @IsString()
  @IsNotEmpty()
  S3_PRIVATE_BUCKET_NAME!: string;

  /** Shared secret that auth_microservice signs access tokens with. */
  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @MinLength(32)
  INTERNAL_API_TOKEN!: string;

  // ---- optional (default in AppConfigService) -----------------------------
  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  CORE_PORT?: number;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  CLIENT_URL?: string;

  @IsOptional()
  @IsString()
  POSTGRES_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  POSTGRES_PORT?: number;

  @IsOptional()
  @IsString()
  POSTGRES_USER?: string;

  @IsOptional()
  @IsString()
  POSTGRES_PASSWORD?: string;

  @IsOptional()
  @IsString()
  DB_NAME_CORE?: string;

  @IsOptional()
  @IsString()
  REDIS_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT?: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @IsString()
  CACHE_REDIS_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  CACHE_REDIS_PORT?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  OUTBOX_MAX_ATTEMPTS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  S3_PORT?: number;

  @IsOptional()
  @IsString()
  S3_BUCKET_NAME?: string;

  @IsOptional()
  @IsString()
  S3_PUBLIC_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  S3_REGION?: string;

  @IsOptional()
  @Matches(/^(true|false)$/i)
  S3_USE_SSL?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  PERF_INSTRUMENTATION?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  SWAGGER_ENABLED?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  SLOW_QUERY_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  UPLOAD_LINK_TTL_SEC?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  UPLOAD_SWEEP_GRACE_SEC?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  UPLOAD_SWEEP_INTERVAL_SEC?: number;
}

/** Placeholder that `.env.production.example` puts in every secret. */
export const PRODUCTION_SECRET_PLACEHOLDER = 'CHANGE_ME';
const PRODUCTION_SECRETS = ['JWT_SECRET', 'INTERNAL_API_TOKEN'] as const;

/** In production, a secret still holding the example placeholder is an error. */
function placeholderErrors(config: Record<string, unknown>): string[] {
  if (config.NODE_ENV !== 'production') return [];
  return PRODUCTION_SECRETS.filter((key) => {
    const value = config[key];
    return (
      typeof value === 'string' && value.includes(PRODUCTION_SECRET_PLACEHOLDER)
    );
  }).map(
    (key) =>
      `${key}: must not be the .env.production.example placeholder in production`,
  );
}

/**
 * `ConfigModule.forRoot({ validate })` hook. Throws one error naming every
 * failing variable (never its value) and returns the raw config unchanged, so
 * `ConfigService.get` keeps returning strings.
 */
export function validate(
  config: Record<string, unknown>,
): Record<string, unknown> {
  // An empty value counts as unset, like the getters in AppConfigService.
  const present = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== ''),
  );
  const instance = plainToInstance(EnvironmentVariables, present, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(instance, { skipMissingProperties: false });
  const lines = [
    ...errors.map(
      (e) =>
        `${e.property}: ${Object.values(e.constraints ?? {}).join('; ') || 'invalid'}`,
    ),
    ...placeholderErrors(present),
  ];
  if (lines.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  ${lines.join('\n  ')}`,
    );
  }
  return config;
}
