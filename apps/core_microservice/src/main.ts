import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import {
  DomainExceptionFilter,
  WinstonLogger,
  httpMetricsMiddleware,
  registerDbPoolGauge,
} from '@repo/shared';
import type { Registry } from 'prom-client';
import { METRICS_REGISTRY } from './common/observability/metrics.tokens';
import { AppConfigService } from './config/app-config.service';
import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

interface PgPoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new WinstonLogger('CoreSystem'),
  });

  // 1. HELMET - Ustawia bezpieczne nagłówki HTTP (np. ukrywa X-Powered-By)
  app.use(helmet());

  // 1b. HTTP METRICS - przed routingiem; trasa jest odczytywana dopiero przy `finish`
  const registry = app.get<Registry>(METRICS_REGISTRY);
  app.use(httpMetricsMiddleware(registry));

  // 2. COOKIE PARSER - Umożliwia odczytywanie refresh_token z ciasteczek
  app.use(cookieParser());

  // 3. CORS - Konfiguracja pozwalająca frontendowi na dostęp
  app.enableCors({
    origin: process.env.CLIENT_URL || 'http://localhost:3000',

    // Pozwala na przesyłanie ciasteczek między domenami
    credentials: true,

    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  const appConfig = app.get(AppConfigService);
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
  app.useGlobalFilters(new DomainExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Innogram Core API')
    .setDescription('The social graph, content, and interactions layer')
    .setVersion('1.0')
    .addTag('Profiles')
    .addTag('Posts')
    .addTag('Comments')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  // This hosts the UI at http://localhost:3002/api
  SwaggerModule.setup('api', app, document);

  app.enableShutdownHooks();
  await app.listen(appConfig.port);
  console.log(`Core microservice runs on ${appConfig.port}`);
}
void bootstrap();
