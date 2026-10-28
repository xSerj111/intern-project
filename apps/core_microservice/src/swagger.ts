import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Tag names, one per public controller; keep in sync with each `@ApiTags`. */
export const SWAGGER_TAGS = [
  'Profiles',
  'Posts',
  'Comments',
  'Follows',
  'Likes',
  'Chats',
  'Uploads',
] as const;

/** OpenAPI document config; exported so e2e specs can build the same document. */
export function buildSwaggerConfig() {
  const builder = new DocumentBuilder()
    .setTitle('Innogram Core API')
    .setDescription('The social graph, content, and interactions layer')
    .setVersion('1.0')
    .addBearerAuth();
  for (const tag of SWAGGER_TAGS) builder.addTag(tag);
  return builder.build();
}

/** Mounts the document and Swagger UI at `/api`. */
export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  SwaggerModule.setup('api', app, document);
}
