import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';
import {
  DomainExceptionFilter,
  WinstonLogger,
  accessLogMiddleware,
  createErrorsCounter,
  httpMetricsMiddleware,
  registerDbPoolGauge,
  requestIdMiddleware,
} from '@repo/shared';
import type { Registry } from 'prom-client';
import { METRICS_REGISTRY } from './common/observability/metrics.tokens';
import { AppConfigService } from './config/app-config.service';
import { setupSwagger } from './swagger';
import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

interface PgPoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

async function bootstrap() {
  const logger = new WinstonLogger('CoreSystem');
  const app = await NestFactory.create(AppModule, { logger });

  // 0. REQUEST ID + ACCESS LOG - first, so every later log line carries the id
  app.use(requestIdMiddleware());
  app.use(accessLogMiddleware(new WinstonLogger('Http')));

  // 1. HELMET - sets secure HTTP headers (e.g. hides X-Powered-By)
  app.use(helmet());

  // 1b. HTTP METRICS - before routing; the route is only read on `finish`
  const registry = app.get<Registry>(METRICS_REGISTRY);
  app.use(httpMetricsMiddleware(registry));

  // 2. COOKIE PARSER - makes the refresh_token cookie readable
  app.use(cookieParser());

  const appConfig = app.get(AppConfigService);

  // 3. CORS - lets the frontend access the API
  app.enableCors({
    origin: appConfig.clientUrl,

    // Allows cookies to be sent across origins
    credentials: true,

    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  appConfig.assertSafeForEnvironment();
  appConfig.assertInternalApiToken();

  // Pool gauge is read on each scrape; `master` is the pg Pool of the TypeORM driver.
  const dataSource = app.get(DataSource);
  registerDbPoolGauge(registry, () => {
    const pool = (dataSource.driver as { master?: PgPoolStats }).master;
    return (
      pool && {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      }
    );
  });

  // Validate & sanitize all incoming DTOs (strips unknown props, coerces types).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Map framework-agnostic domain errors (entities/repositories) to HTTP responses.
  app.useGlobalFilters(
    new DomainExceptionFilter(createErrorsCounter(registry)),
  );

  // Swagger UI at /api (http://localhost:3001/api); off by default in production.
  if (appConfig.swaggerEnabled) setupSwagger(app);

  app.enableShutdownHooks();
  await app.listen(appConfig.port);
  logger.info(`Core microservice runs on ${appConfig.port}`);
}
void bootstrap();
