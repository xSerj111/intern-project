import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

// 1. Load environment variables manually for the CLI
// Assuming your .env file is at the root of the monorepo (Innogram/.env)
dotenv.config({ path: join(__dirname, '../../.env') });

function requireCliEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  // No default credentials, as in the app: a missing one throws.
  username: requireCliEnv('POSTGRES_USER'),
  password: requireCliEnv('POSTGRES_PASSWORD'),

  // We keep this specific to Auth so we don't mix tables with Core
  database: process.env.DB_NAME_AUTH || 'innogram_auth',

  synchronize: false,
  logging: true,
  entities: [join(__dirname, 'src/**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'src/migrations/*{.ts,.js}')],
});
