import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

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

  // Target the isolated Notifications database
  database: process.env.DB_NAME_NOTIFICATIONS || 'innogram_notifications',

  synchronize: false,
  logging: true,
  // Entities live under src/modules/<m>/domain/entities (`*.entity.ts`).
  entities: [join(__dirname, 'src/**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'src/migrations/*{.ts,.js}')],
});
