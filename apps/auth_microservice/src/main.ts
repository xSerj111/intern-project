import 'reflect-metadata';
import { env } from './config/env';

import { WinstonLogger } from '@repo/shared';
import { initDatabase } from './config/database';
import { createApp } from './app';
import { createRedisClient } from './config/redis';
import { RedisService } from './infrastructure/cache/redis.service';

async function bootstrap() {
  const logger = new WinstonLogger('AuthMicroservice');

  try {
    // 1. Inicjalizacja bazy danych (funkcja wygenerowana przez DeepCode)
    const dataSource = await initDatabase();
    logger.debug('Database connected successfully');

    const redisClient = createRedisClient();
    const redisService = new RedisService(redisClient, logger);

    // 2. Inicjalizacja aplikacji Express z wstrzykniętymi zależnościami
    const app = createApp(dataSource, logger, redisService);
    const port = env.app.port;

    // 3. Uruchomienie serwera
    const server = app.listen(port, () => {
      logger.info(`Auth Microservice is running on port ${port}`);
    });

    // Wdrożenie "Graceful Shutdown"
    const shutdown = async (signal: string) => {
      logger.info(`${signal} recieved, shutting down gracefully...`);
      server.close();
      try {
        await redisClient.quit();
        logger.debug('Redis disconnected');
      } catch (err) {
        logger.error('Error disconnecting Redis', { error: err });
      }
      try {
        await dataSource.destroy();
        logger.debug('Database disconnected');
      } catch (err) {
        logger.error('Error disconnecting database', { error: err });
      }
      logger.info('Graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Failed to start Auth Microservice', { error });
    process.exit(1);
  }
}

bootstrap();
