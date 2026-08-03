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

export const env = {
  app: {
    // Auth service domyślnie działa na 3002 (zgodnie z AUTH_SERVICE_URL z .env)
    port: parseInt(process.env.PORT || '3002', 10),
    coreMicroserviceUrl: requireEnv('CORE_SERVICE_URL'),
    allowedOrigins: requireEnv('AUTH_ALLOWED_ORIGINS'),
  },
  db: {
    host: requireEnv('POSTGRES_HOST', 'localhost'),
    port: parseInt(requireEnv('POSTGRES_PORT', '5432'), 10),
    username: requireEnv('POSTGRES_USER', 'innogram_user'),
    password: requireEnv('POSTGRES_PASSWORD', 'innogram_password'),
    database: requireEnv('POSTGRES_DB', 'innogram'),
  },
  redis: {
    host: requireEnv('REDIS_HOST', 'localhost'),
    port: parseInt(requireEnv('REDIS_PORT', '6379'), 10),
    password: process.env.REDIS_PASSWORD || undefined, // Hasło może być puste
  },
  jwt: {
    accessTokenSecret: requireEnv('JWT_SECRET', 'your-super-secret-jwt-key-here'),
    accessTokenExpiry: requireEnv('JWT_EXPIRES_IN', '15m'),
    refreshTokenExpiry: requireEnv('JWT_REFRESH_EXPIRES_IN', '7d'),
  },
  google: {
    clientId: requireEnv('GOOGLE_CLIENT_ID', 'your-google-client-id'),
  },
  crypto: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10),
  },
} as const;
