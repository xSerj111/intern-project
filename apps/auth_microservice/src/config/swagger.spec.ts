// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);
process.env.POSTGRES_USER = 'test-user';
process.env.POSTGRES_PASSWORD = 'test-password';

import express from 'express';
import request from 'supertest';
import { env } from './env';
import { OPENAPI_JSON_PATH, SWAGGER_UI_PATH, setupSwagger } from './swagger';

describe('setupSwagger', () => {
  const appWith = (enabled: boolean) => {
    const app = express();
    setupSwagger(app, enabled);
    return app;
  };

  it('serves the OpenAPI JSON and the UI when enabled', async () => {
    const app = appWith(true);

    const res = await request(app).get(OPENAPI_JSON_PATH).expect(200);
    expect(res.body).toMatchObject({
      openapi: '3.0.3',
      servers: [{ url: env.app.publicUrl }],
    });
    expect(Object.keys((res.body as { paths: object }).paths)).toContain('/auth/login');

    const ui = await request(app).get(`${SWAGGER_UI_PATH}/`).expect(200);
    expect(ui.text).toContain('swagger-ui');
  });

  it('serves nothing when disabled', async () => {
    const app = appWith(false);

    await request(app).get(OPENAPI_JSON_PATH).expect(404);
    await request(app).get(`${SWAGGER_UI_PATH}/`).expect(404);
  });
});
