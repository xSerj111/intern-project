import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Swagger UI path; the raw document is served at `${SWAGGER_PATH}-json`. */
export const SWAGGER_PATH = 'api';

/** Document metadata and the bearer scheme used by `@ApiBearerAuth()`. */
export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Innogram Notifications API')
    .setDescription('Notification feed and email preferences')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
}

/** Mounts Swagger UI at `/api`. `main.ts` calls it only when SWAGGER_ENABLED. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(
    SWAGGER_PATH,
    app,
    SwaggerModule.createDocument(app, buildSwaggerConfig()),
  );
}
