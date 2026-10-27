import { Router, type Application } from 'express';
import swaggerUi from 'swagger-ui-express';
import { env } from './env';
import { buildOpenApiDocument } from './openapi';

export const SWAGGER_UI_PATH = '/api';
export const OPENAPI_JSON_PATH = '/api-json';

/** Serves Swagger UI at `/api` and the raw document at `/api-json` when enabled. */
export function setupSwagger(
  app: Application,
  enabled: boolean = env.swagger.enabled,
): void {
  if (!enabled) return;

  const document = buildOpenApiDocument(env.app.publicUrl);
  const router = Router();
  router.get(OPENAPI_JSON_PATH, (_req, res) => {
    res.json(document);
  });
  router.use(SWAGGER_UI_PATH, swaggerUi.serve, swaggerUi.setup(document));
  app.use(router);
}
