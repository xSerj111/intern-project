import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { DomainExceptionFilter } from '@repo/shared';
import { AppConfigService } from './config/app-config.service';
import 'reflect-metadata';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const appConfig = app.get(AppConfigService);

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

  await app.listen(appConfig.port);
  console.log(`Core microservice runs on ${appConfig.port}`);
}
bootstrap();
