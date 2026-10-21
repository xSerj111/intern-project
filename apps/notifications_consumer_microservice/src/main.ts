import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  type DbPoolStats,
  DomainExceptionFilter,
  httpMetricsMiddleware,
  registerDbPoolGauge,
  WinstonLogger,
  type createMetricsRegistry,
} from '@repo/shared';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { METRICS_REGISTRY } from './common/observability/metrics.tokens';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new WinstonLogger('NotificationsSystem'),
  });
  const appConfig = app.get(AppConfigService);

  const registry =
    app.get<ReturnType<typeof createMetricsRegistry>>(METRICS_REGISTRY);
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
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // Validate & sanitize incoming DTOs; map domain errors -> HTTP (shared infra).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Innogram Notifications API')
    .setDescription('Notification feed and email preferences')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));

  // Consumers drain, then channels, Redis and SMTP close on SIGTERM.
  app.enableShutdownHooks();
  // Own variable, not the shared PORT - see the other services' config.
  await app.listen(appConfig.port);
}
void bootstrap();
