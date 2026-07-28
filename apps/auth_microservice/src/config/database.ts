import { DataSource } from 'typeorm';
import { AuthUser } from '../entities/auth-user.entity';
import { AuthSession } from '../entities/auth-session.entity';
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
  entities: [AuthUser, AuthSession],
  synchronize: false,
  migrations: [__dirname + '/../migrations/*.ts'],
});

export async function initDatabase(): Promise<DataSource> {
  if (AppDataSource.isInitialized) {
    return AppDataSource;
  }
  return AppDataSource.initialize();
}
