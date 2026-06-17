import { DataSource } from 'typeorm';

export const createDataSource = () => {
  return new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,

    // IMPORTANT: temporary (we will improve in Step 4)
    entities: [__dirname + '/entities/*.entity.{ts,js}'],

    synchronize: false,
  });
};