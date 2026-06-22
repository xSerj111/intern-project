import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

// 1. Load environment variables manually for the CLI
// Assuming your .env file is at the root of the monorepo (Innogram/.env)
dotenv.config({ path: join(__dirname, '../../.env') }); 

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  // Specific database for the Auth microservice
  database: process.env.DB_NAME_AUTH || 'innogram_auth',
  
  // 🚨 CRITICAL: Turn off synchronize because we are now using migrations!
  synchronize: false, 
  logging: true,
  
  // Dynamically load all entities and migrations
  entities: [join(__dirname, 'src/**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'src/migrations/*{.ts,.js}')],
});