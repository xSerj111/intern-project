import helmet from 'helmet';
import express, { Application, Router } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  createMetricsRegistry,
  httpMetricsMiddleware,
  httpStatusFor,
  registerDbPoolGauge,
  requireInternalToken,
  runHealthChecks,
  type HealthCheck,
  type WinstonLogger,
} from '@repo/shared';
import { BcryptService } from './infrastructure/crypto/crypto.service';
import { AuthUserRepository } from './infrastructure/repositories/auth-user.repository';
import { GoogleOAuthService } from './infrastructure/oauth/google-oauth.service';
import { createUsersRouter } from './routes/users.routes';
import { createAuthRouter } from './routes/auth.routes';
import { createInternalRouter } from './routes/internal.routes';
import { createInternalTokenMiddleware } from './middleware/internal-token.middleware';
import { errorHandler } from './middleware/error-handler.middleware';
import { UsersService } from './services/users.service';
import { AuthService } from './services/auth.service';
import { setupSwagger } from './config/swagger';
import { RedisService } from './infrastructure/cache/redis.service';
import { env } from './config/env';
import { JwtService } from './infrastructure/jwt/jwt.service';
import { RedisSessionRevocationPublisher } from './infrastructure/events/redis-session-revocation.publisher';
import { HttpEventPublisher } from './infrastructure/events/http-event-publisher';
import { createDatabaseCheck, getPgPool } from './infrastructure/health/database.check';
import { createRedisCheck } from './infrastructure/health/redis.check';

type MetricsRegistry = ReturnType<typeof createMetricsRegistry>;

export interface ObservabilityOptions {
  /** Overrides the default `database` + `redis` checks (tests). */
  healthChecks?: HealthCheck[];
  metricsRegistry?: MetricsRegistry;
}

/** `/health` (public), `/health/details` and `/metrics` (X-Internal-Token). */
function createObservabilityRouter(
  registry: MetricsRegistry,
  checks: HealthCheck[],
): Router {
  const router = Router();
  const internalOnly = requireInternalToken(env.app.internalApiToken);

  router.get('/health', (_req, res, next) => {
    runHealthChecks('auth', checks)
      .then((report) => {
        res.status(httpStatusFor(report.status)).json({ status: report.status });
      })
      .catch(next);
  });

  router.get('/health/details', internalOnly, (_req, res, next) => {
    runHealthChecks('auth', checks)
      .then((report) => {
        res.status(httpStatusFor(report.status)).json(report);
      })
      .catch(next);
  });

  router.get('/metrics', internalOnly, (_req, res, next) => {
    registry
      .metrics()
      .then((body) => {
        res.set('Content-Type', registry.contentType);
        res.send(body);
      })
      .catch(next);
  });

  return router;
}

export function createApp(
  dataSource: DataSource,
  logger: WinstonLogger,
  redisService: RedisService,
  sessionRedisClient: Redis,
  observability: ObservabilityOptions = {},
): Application {
  const app = express();

  const registry = observability.metricsRegistry ?? createMetricsRegistry('auth');
  registerDbPoolGauge(registry, () => getPgPool(dataSource));
  const healthChecks = observability.healthChecks ?? [
    createDatabaseCheck(dataSource),
    // Same Redis server as the session store; this connection is never in subscriber mode.
    createRedisCheck(sessionRedisClient),
  ];

  // Before every router, so all routes are timed (it skips /health and /metrics itself).
  app.use(httpMetricsMiddleware(registry));

  app.use(express.json());
  app.use(cookieParser());

  app.use(helmet());

  app.use(
    cors({
      origin: env.app.allowedOrigins.split(',').map((origin) => origin.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  setupSwagger(app);

  const cryptoService = new BcryptService(env.crypto.saltRounds);

  const authUserRepository = new AuthUserRepository(dataSource);
  const jwtService = new JwtService();
  const oauthService = new GoogleOAuthService();
  const eventPublisher = new HttpEventPublisher(logger);

  const usersService = new UsersService(
    authUserRepository,
    logger,
    cryptoService,
    eventPublisher,
  );
  const authService = new AuthService(
    usersService,
    redisService,
    logger,
    cryptoService,
    jwtService,
    oauthService,
    new RedisSessionRevocationPublisher(sessionRedisClient, logger),
  );

  app.use(createObservabilityRouter(registry, healthChecks));
  app.use('/users', createUsersRouter(usersService));
  app.use('/auth', createAuthRouter(authService));

  app.use(errorHandler);

  return app;
}

/**
 * Service-to-service app, served from its own listener (`AUTH_INTERNAL_PORT`,
 * bound to `AUTH_INTERNAL_HOST`). Deliberately separate from `createApp()`: no
 * CORS, no Swagger, and the public port never serves `/internal`.
 */
export function createInternalApp(
  dataSource: DataSource,
  logger: WinstonLogger,
): Application {
  const app = express();

  app.use(express.json());
  app.use(helmet());

  app.use(
    '/internal',
    createInternalTokenMiddleware(logger),
    createInternalRouter(new AuthUserRepository(dataSource)),
  );

  app.use(errorHandler);

  return app;
}
