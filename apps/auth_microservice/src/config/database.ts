import { DataSource } from 'typeorm';
import { AuthUser } from '../domain/entities/auth-user.entity';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { env } from './env';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env.db.host,
  port: env.db.port,
  username: env.db.username,
  password: env.db.password,
  database: env.db.database,
  entities: [AuthUser],
  synchronize: false,
  migrations: [__dirname + '/../migrations/*.ts'],
});

export async function initDatabase(): Promise<DataSource> {
  if (AppDataSource.isInitialized) {
    return AppDataSource;
  }
  return AppDataSource.initialize();
}
