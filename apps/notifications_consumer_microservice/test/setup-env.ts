import * as path from 'node:path';
import { config } from 'dotenv';

// Jest `setupFiles` entry: startup env validation needs every required var.
// Load the real root .env first (never overrides what is already set), then
// fill only the still-unset required vars with inert test values.
config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const fixtures: Record<string, string> = {
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
  JWT_SECRET: 'test-jwt-secret',
  INTERNAL_API_TOKEN: 'test-internal-api-token-0123456789abcdef',
  AUTH_INTERNAL_URL: 'http://localhost:3012',
  CLIENT_URL: 'http://localhost:3000',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  SMTP_FROM: 'Innogram <no-reply@innogram.local>',
};

for (const [key, value] of Object.entries(fixtures)) {
  process.env[key] ??= value;
}
