import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainExceptionFilter, WinstonLogger } from '@repo/shared';
import 'reflect-metadata';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new WinstonLogger('NotificationsSystem'),
  });

  // Validate & sanitize incoming DTOs; map domain errors -> HTTP (shared infra).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DomainExceptionFilter());

  // Own variable, not the shared PORT - see the other services' config.
  await app.listen(process.env.NOTIFICATIONS_PORT ?? 3003);
}
bootstrap();
