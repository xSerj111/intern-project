// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000, http://localhost:4000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

import request from 'supertest';
import type { Application } from 'express';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import type { WinstonLogger } from '@repo/shared';
import { createApp } from './app';
import { RedisService } from './infrastructure/cache/redis.service';

describe('public app', () => {
  let app: Application;

  beforeEach(() => {
    const dataSource = {
      getRepository: () => ({ metadata: { tableName: 'auth_users' } }),
    } as unknown as DataSource;
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as WinstonLogger;
    app = createApp(
      dataSource,
      logger,
      {} as unknown as RedisService,
      { publish: jest.fn() } as unknown as Redis,
    );
  });

  const preflight = (origin: string) =>
    request(app)
      .options('/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

  it('does not allow a preflight from an origin outside the allowlist', async () => {
    const res = await preflight('http://evil.test');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('echoes an allowlisted origin (comma-separated list) with credentials', async () => {
    for (const origin of ['http://localhost:3000', 'http://localhost:4000']) {
      const res = await preflight(origin);

      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    }
  });

  it('does not expose users by id on the public port', async () => {
    await request(app).get('/users/7c9e6679-7425-40de-944b-e07fc1f90ae7').expect(404);
  });
});
