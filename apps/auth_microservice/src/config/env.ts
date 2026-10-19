import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// Funkcja pomocnicza wymuszająca obecność zmiennych (Fail-Fast)
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
    // Auth service domyślnie działa na 3002 (zgodnie z AUTH_SERVICE_URL z .env)
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
    password: process.env.REDIS_PASSWORD || undefined, // Hasło może być puste
  },
  jwt: {
    accessTokenSecret: requireEnv('JWT_SECRET', 'your-super-secret-jwt-key-here'),
    refreshTokenSecret: requireEnv(
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
