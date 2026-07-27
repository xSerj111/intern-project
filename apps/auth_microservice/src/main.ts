import * as dotenv from 'dotenv';
dotenv.config();

import { WinstonLogger } from '@repo/shared';
import { initDatabase } from './config/database';
import { createApp } from './app';

async function bootstrap() {
  const logger = new WinstonLogger('AuthMicroservice');

  try {
    // 1. Inicjalizacja bazy danych (funkcja wygenerowana przez DeepCode)
    const dataSource = await initDatabase();
    logger.debug('Database connected successfully');

    // 2. Inicjalizacja aplikacji Express z wstrzykniętymi zależnościami
    const app = createApp(dataSource, logger);
    const port = process.env.PORT || 3001;

    // 3. Uruchomienie serwera
    app.listen(port, () => {
      logger.info(`Auth Microservice is running on port ${port}`);
    });
  } catch (error) {
    logger.error('Failed to start Auth Microservice', { error });
    process.exit(1);
  }
}

bootstrap();
