import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Env fixture for e2e suites that boot `AppModule` (whose config validation
 * rejects missing required variables). Real values always win: the `.env`
 * files are loaded without overriding the process env, and the placeholders
 * below only fill what is still unset, so they never reach a real service.
 */
// Same files and parser as ConfigModule, so both see identical values.
config({
  path: [resolve(__dirname, '../.env'), resolve(__dirname, '../../../.env')],
  quiet: true,
});

const defaults: Record<string, string> = {
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
  S3_ENDPOINT: 'localhost',
  S3_ACCESS_KEY: 'test-access-key',
  S3_SECRET_KEY: 'test-secret-key',
  S3_PRIVATE_BUCKET_NAME: 'innogram-private',
  JWT_SECRET: 'test-jwt-secret',
  INTERNAL_API_TOKEN: 'test-internal-api-token-0123456789abcdef',
  POSTGRES_USER: 'test-user',
  POSTGRES_PASSWORD: 'test-password',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
