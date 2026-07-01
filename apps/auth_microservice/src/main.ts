import dotenv from 'dotenv';
import { resolve } from 'path';
import { WinstonLogger } from '@repo/shared';
import app from './app';
import { initDatabase } from './config/database';

// Load .env from monorepo root first, then local
dotenv.config({ path: resolve(__dirname, '../../.env') });
dotenv.config();

const logger = new WinstonLogger('AuthMicroservice');

async function bootstrap(): Promise<void> {
  try {
    await initDatabase();
    logger.info('Database connection established');
  } catch (err) {
    logger.error('Failed to connect to database', { error: err });
    process.exit(1);
  }

  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    logger.info(`Auth Microservice running on port ${port}`);
  });
}

bootstrap();
