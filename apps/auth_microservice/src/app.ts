import express, { Application } from 'express';
import cors from 'cors';
import { DataSource } from 'typeorm';
import { WinstonLogger } from '@repo/shared';
import { createUsersRouter } from './routes/users.routes';
import { errorHandler } from './middleware/error-handler.middleware';
import { UsersService } from './services/users.service';
import { setupSwagger } from './config/swagger';

const app = express();

// Global middlewares
app.use(express.json());
app.use(cors());

// Routes and error handler will be added in Phase 3

export function createApp(
  dataSource: DataSource,
  logger: WinstonLogger,
): Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  setupSwagger(app);

  const usersService = new UsersService(dataSource, logger);

  app.use('/users', createUsersRouter(usersService));

  app.use(errorHandler);

  return app;
}
