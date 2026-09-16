import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { corePostgresConnection } from './src/database/database.config';
// Load root .env
dotenv.config({ path: join(__dirname, '../../.env') });
export const AppDataSource = new DataSource({
    ...corePostgresConnection(),
    logging: true,
    entities: [join(__dirname, 'src/**/*.entity{.ts,.js}')],
    migrations: [join(__dirname, 'src/migrations/*{.ts,.js}')],
});
