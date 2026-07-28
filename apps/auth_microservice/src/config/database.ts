import { DataSource } from 'typeorm';
import { AuthUser } from '../entities/auth-user.entity';
import { AuthSession } from '../entities/auth-session.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.DB_NAME_AUTH || 'innogram_auth',
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
  entities: [AuthUser, AuthSession],
});

export async function initDatabase(): Promise<DataSource> {
  if (AppDataSource.isInitialized) {
    return AppDataSource;
  }
  return AppDataSource.initialize();
}
