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
    port: parseInt(requireEnv('PORT', '3001'), 10),
  },
  db: {
    host: requireEnv('DB_HOST', '127.0.0.1'),
    port: parseInt(requireEnv('DB_PORT', '5432'), 10),
    username: requireEnv('DB_USER', 'postgres'),
    password: requireEnv('DB_PASSWORD', 'secret'),
    database: requireEnv('DB_NAME', 'innogram'),
  },
  redis: {
    url: requireEnv('REDIS_URL', 'redis://localhost:6379'),
  },
  jwt: {
    accessTokenSecret: requireEnv('JWT_ACCESS_SECRET', 'default-dev-secret'),
    accessTokenExpiry: requireEnv('JWT_ACCESS_EXPIRY', '15m'),
    refreshTokenExpiry: requireEnv('JWT_REFRESH_EXPIRY', '7d'),
  },
  google: {
    clientId: requireEnv(
      'GOOGLE_CLIENT_ID',
      'dev-google-client-id.apps.googleusercontent.com',
    ),
  },
} as const;
