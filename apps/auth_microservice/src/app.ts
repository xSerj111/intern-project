import express, { Application } from 'express';
import cors from 'cors';
import { DataSource } from 'typeorm';
import type { WinstonLogger } from '@repo/shared';
import { BcryptService } from './infrastructure/crypto/crypto.service';
import { AuthUserRepository } from './infrastructure/repositories/auth-user.repository';

import { createUsersRouter } from './routes/users.routes';
import { createAuthRouter } from './routes/auth.routes';
import { errorHandler } from './middleware/error-handler.middleware';
import { UsersService } from './services/users.service';
import { AuthService } from './services/auth.service';
import { setupSwagger } from './config/swagger';
import { RedisService } from './infrastructure/cache/redis.service';
import { env } from './config/env';
import { JwtService } from './infrastructure/jwt/jwt.service';

export function createApp(
  dataSource: DataSource,
  logger: WinstonLogger,
  redisService: RedisService,
): Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  setupSwagger(app);

  const cryptoService = new BcryptService(env.crypto.saltRounds);

  const authUserRepository = new AuthUserRepository(dataSource);
  const jwtService = new JwtService();

  const usersService = new UsersService(authUserRepository, logger, cryptoService);
  const authService = new AuthService(
    usersService,
    redisService,
    logger,
    cryptoService,
    jwtService,
  ); // <-- DODANE

  app.use('/users', createUsersRouter(usersService));
  app.use('/auth', createAuthRouter(authService)); // <-- DODANE

  app.use(errorHandler);

  return app;
}
