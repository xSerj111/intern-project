import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// Helper that enforces required variables are present (fail-fast)
const requireEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key] || defaultValue;
  if (!value) {
    throw new Error(`Missing required enviroment variable: ${key}`);
  }
  return value;
};

const INTERNAL_API_TOKEN_MIN_LENGTH = 32;

// No default on purpose: a guessable fallback would defeat the internal-only check.
const requireInternalApiToken = (): string => {
  const token = requireEnv('INTERNAL_API_TOKEN');
  if (token.length < INTERNAL_API_TOKEN_MIN_LENGTH) {
    throw new Error(
      `INTERNAL_API_TOKEN must be at least ${INTERNAL_API_TOKEN_MIN_LENGTH} characters long`,
    );
  }
  return token;
};

const JWT_SECRET_MIN_LENGTH = 32;

// Must stay identical to the JWT_* values in the root .env.example.
export const JWT_PLACEHOLDER_SECRETS: readonly string[] = [
  'your-super-secret-jwt-key-here',
  'your-super-secret-jwt-refresh-key-here',
];

// Production has no fallback and refuses short or copied-from-example secrets.
// Outside production the dev default is kept. Errors name the variable only.
const requireJwtSecret = (key: string, devDefault: string): string => {
  if (process.env.NODE_ENV !== 'production') return requireEnv(key, devDefault);
  const secret = requireEnv(key);
  if (JWT_PLACEHOLDER_SECRETS.includes(secret)) {
    throw new Error(
      `${key} must not be the .env.example placeholder value in production`,
    );
  }
  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `${key} must be at least ${JWT_SECRET_MIN_LENGTH} characters long in production`,
    );
  }
  return secret;
};

const SAME_SITE_VALUES = ['strict', 'lax', 'none'] as const;
type SameSite = (typeof SAME_SITE_VALUES)[number];

const parseSameSite = (value: string | undefined): SameSite => {
  if (!value) return 'strict';
  if (!(SAME_SITE_VALUES as readonly string[]).includes(value)) {
    throw new Error(
      `AUTH_COOKIE_SAMESITE must be one of: ${SAME_SITE_VALUES.join(', ')}`,
    );
  }
  return value as SameSite;
};

export const env = {
  app: {
    // Auth service listens on 3002 by default (matches AUTH_SERVICE_URL in .env)
    // Own variable, not the shared PORT: every service reads the same root
    // config file, so a single PORT makes two services fight over one socket.
    port: parseInt(process.env.AUTH_PORT || '3002', 10),
    coreMicroserviceUrl: requireEnv('CORE_SERVICE_URL'),
    allowedOrigins: requireEnv('AUTH_ALLOWED_ORIGINS'),
    // Separate listener for service-to-service endpoints; never published or proxied.
    internalPort: parseInt(process.env.AUTH_INTERNAL_PORT || '3012', 10),
    internalHost: process.env.AUTH_INTERNAL_HOST || '127.0.0.1',
    internalApiToken: requireInternalApiToken(),
  },
  db: {
    host: requireEnv('POSTGRES_HOST', 'localhost'),
    port: parseInt(requireEnv('POSTGRES_PORT', '5432'), 10),
    username: requireEnv('POSTGRES_USER', 'innogram_user'),
    password: requireEnv('POSTGRES_PASSWORD', 'innogram_password'),
    // Must match data-source.ts, which the migration CLI uses, or the app talks
    // to a different database than the one the migrations built.
    database: requireEnv('DB_NAME_AUTH', 'innogram_auth'),
  },
  redis: {
    host: requireEnv('REDIS_HOST', 'localhost'),
    port: parseInt(requireEnv('REDIS_PORT', '6379'), 10),
    password: process.env.REDIS_PASSWORD || undefined, // Password may be empty
  },
  jwt: {
    accessTokenSecret: requireJwtSecret('JWT_SECRET', 'your-super-secret-jwt-key-here'),
    refreshTokenSecret: requireJwtSecret(
      'JWT_REFRESH_SECRET',
      'your-super-secret-jwt-refresh-key-here',
    ),
    accessTokenExpiry: requireEnv('JWT_EXPIRES_IN', '15m'),
    refreshTokenExpiry: requireEnv('JWT_REFRESH_EXPIRES_IN', '7d'),
  },
  google: {
    clientId: requireEnv('GOOGLE_CLIENT_ID', 'your-google-client-id'),
  },
  crypto: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10),
  },
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    // 'strict' works while client and auth share a site (localhost:3000 -> :3002);
    // a cross-site deployment needs 'none' (which browsers only accept with secure).
    sameSite: parseSameSite(process.env.AUTH_COOKIE_SAMESITE),
  },
} as const;
