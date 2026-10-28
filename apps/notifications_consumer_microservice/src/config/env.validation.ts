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

  /** Serve Swagger UI; default true unless NODE_ENV=production. */
  @IsOptional()
  @Matches(/^(true|false)$/, {
    message: 'SWAGGER_ENABLED must be "true" or "false"',
  })
  SWAGGER_ENABLED?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  POSTGRES_HOST?: string;

  @IsOptional()
  @IsInt()
  @Min(PORT.min)
  @Max(PORT.max)
  POSTGRES_PORT?: number;

  @IsString()
  @IsNotEmpty()
  POSTGRES_USER!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD!: string;

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
/** Every secret notifications reads; none may keep the placeholder in production. */
const PRODUCTION_SECRETS = [
  'JWT_SECRET',
  'INTERNAL_API_TOKEN',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'RABBITMQ_URL',
  'SMTP_PASS',
] as const;
/** Optional in development, required when `NODE_ENV=production`. */
const REQUIRED_IN_PRODUCTION = ['REDIS_PASSWORD'] as const;

/**
 * In production, a secret still holding the example placeholder is an error,
 * and so is a missing production-only secret.
 */
function productionErrors(config: Record<string, unknown>): string[] {
  if (config.NODE_ENV !== 'production') return [];
  const missing = REQUIRED_IN_PRODUCTION.filter(
    (key) => config[key] === undefined,
  ).map((key) => `${key}: is required in production`);
  const placeholders = PRODUCTION_SECRETS.filter((key) => {
    const value = config[key];
    return (
      typeof value === 'string' && value.includes(PRODUCTION_SECRET_PLACEHOLDER)
    );
  }).map(
    (key) =>
      `${key}: must not be the .env.production.example placeholder in production`,
  );
  return [...missing, ...placeholders];
}

/**
 * `ConfigModule.forRoot({ validate })` hook. Throws one error naming every
 * failing variable; never echoes a value, so secrets stay out of the logs.
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // An empty value counts as unset, like the getters in AppConfigService.
  const present = Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== ''),
  );
  const validated = plainToInstance(EnvironmentVariables, present, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  const lines = [
    ...errors.map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`,
    ),
    ...productionErrors(present),
  ];
  if (lines.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  ${lines.join('\n  ')}`,
    );
  }
  return validated;
}
