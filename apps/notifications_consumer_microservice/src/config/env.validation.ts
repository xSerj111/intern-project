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

const PORT = { min: 1, max: 65535 };
const URL_OPTIONS = { require_tld: false, require_protocol: true };

/**
 * Environment contract of the Notifications service. A variable without a
 * default in `AppConfigService` is required here; one with a default is
 * optional and only type/range checked when present.
 */
export class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'test', 'production'])
  NODE_ENV?: string;

  @IsOptional()
  @IsInt()
  @Min(PORT.min)
  @Max(PORT.max)
  NOTIFICATIONS_PORT?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  POSTGRES_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(PORT.min)
  @Max(PORT.max)
  POSTGRES_PORT?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  POSTGRES_USER?: string;

  @IsOptional()
  @IsString()
  POSTGRES_PASSWORD?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  DB_NAME_NOTIFICATIONS?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  REDIS_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(PORT.min)
  @Max(PORT.max)
  REDIS_PORT?: number;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsString()
  @IsNotEmpty()
  RABBITMQ_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string;

  @IsString()
  @MinLength(32)
  INTERNAL_API_TOKEN!: string;

  @IsUrl(URL_OPTIONS)
  AUTH_INTERNAL_URL!: string;

  @IsUrl(URL_OPTIONS)
  CLIENT_URL!: string;

  @IsString()
  @IsNotEmpty()
  SMTP_HOST!: string;

  @IsInt()
  @Min(PORT.min)
  @Max(PORT.max)
  SMTP_PORT!: number;

  @Matches(/^(true|false)$/i, {
    message: 'SMTP_SECURE must be "true" or "false"',
  })
  SMTP_SECURE!: string;

  @IsString()
  @IsNotEmpty()
  SMTP_FROM!: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASS?: string;
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
 * failing variable; never echoes a value, so secrets stay out of the logs.
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  const lines = [
    ...errors.map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
    ),
    ...placeholderErrors(config),
  ];
  if (lines.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  ${lines.join('\n  ')}`,
    );
  }
  return validated;
}
