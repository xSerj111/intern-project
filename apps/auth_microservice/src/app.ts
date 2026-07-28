import express, { Application } from 'express';
import cors from 'cors';
import { DataSource } from 'typeorm';
import type { WinstonLogger } from '@repo/shared';
import { BcryptService } from './services/crypto.service';

import { createUsersRouter } from './routes/users.routes';
import { createAuthRouter } from './routes/auth.routes';
import { errorHandler } from './middleware/error-handler.middleware';
import { UsersService } from './services/users.service';
import { AuthService } from './services/auth.service';
import { setupSwagger } from './config/swagger';
import { RedisService } from './services/redis.service';

export function createApp(
  dataSource: DataSource,
  logger: WinstonLogger,
  redisService: RedisService,
): Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  setupSwagger(app);

  const cryptoService = new BcryptService();

  const usersService = new UsersService(dataSource, logger, cryptoService);
  const authService = new AuthService(
    usersService,
    redisService,
    logger,
    cryptoService,
  ); // <-- DODANE

  app.use('/users', createUsersRouter(usersService));
  app.use('/auth', createAuthRouter(authService)); // <-- DODANE

  app.use(errorHandler);

  return app;
}
