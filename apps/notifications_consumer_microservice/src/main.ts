import { ValidationPipe } from '@nestjs/common';
import { BaseExceptionFilter, NestFactory } from '@nestjs/core';
import {
  accessLogMiddleware,
  AllExceptionsFilter,
  createErrorsCounter,
  type DbPoolStats,
  httpMetricsMiddleware,
  registerDbPoolGauge,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  requestIdMiddleware,
  WinstonLogger,
  type createMetricsRegistry,
} from '@repo/shared';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { METRICS_REGISTRY } from './common/observability/metrics.tokens';
import { AppConfigService } from './config/app-config.service';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const logger = new WinstonLogger('NotificationsSystem');
  const app = await NestFactory.create(AppModule, { logger });
  const appConfig = app.get(AppConfigService);

  const registry =
    app.get<ReturnType<typeof createMetricsRegistry>>(METRICS_REGISTRY);
  // Request id first, so every later middleware and handler sees it.
  app.use(requestIdMiddleware());
  app.use(accessLogMiddleware(logger));
  app.use(httpMetricsMiddleware(registry));
  const dataSource = app.get(DataSource);
  registerDbPoolGauge(
    registry,
    // pg's Pool is the postgres driver's `master`; it is absent until connected.
    () => (dataSource.driver as unknown as { master?: DbPoolStats }).master,
  );

  app.enableCors({
    origin: appConfig.clientUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    // The request id header is allowed and exposed, so the client can quote it in error reports.
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
  });

  // Validate & sanitize incoming DTOs; map domain errors -> HTTP (shared infra),
  // other errors keep Nest's default response. Every error response is counted.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(
    new AllExceptionsFilter(
      new BaseExceptionFilter(app.getHttpAdapter()),
      createErrorsCounter(registry),
    ),
  );

  // On by default; off in production unless SWAGGER_ENABLED=true.
  if (appConfig.swaggerEnabled) setupSwagger(app);

  // Consumers drain, then channels, Redis and SMTP close on SIGTERM.
  app.enableShutdownHooks();
  // Own variable, not the shared PORT - see the other services' config.
  await app.listen(appConfig.port);
}
void bootstrap();
