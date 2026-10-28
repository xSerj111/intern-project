// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 't'.repeat(40);

import request from 'supertest';
import type { Application } from 'express';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import {
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  type HealthCheck,
  type WinstonLogger,
} from '@repo/shared';
import { createApp } from './app';
import { RedisService } from './infrastructure/cache/redis.service';

const TOKEN = 't'.repeat(40);
const UNAUTHORIZED = { statusCode: 401, message: 'Unauthorized' };

const check = (name: string, critical: boolean, up: boolean): HealthCheck => ({
  name,
  critical,
  run: up
    ? () => Promise.resolve()
    : () => Promise.reject(new Error('postgres://user:secret@db:5432/innogram_auth')),
});

function buildApp(healthChecks: HealthCheck[]): Application {
  const dataSource = {
    getRepository: () => ({ metadata: { tableName: 'auth_users' } }),
    driver: { master: { totalCount: 4, idleCount: 3, waitingCount: 0 } },
  } as unknown as DataSource;
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as WinstonLogger;
  return createApp(
    dataSource,
    logger,
    {} as unknown as RedisService,
    { publish: jest.fn() } as unknown as Redis,
    { healthChecks },
  );
}

describe('auth observability endpoints', () => {
  const healthy = () =>
    buildApp([check('database', true, true), check('redis', true, true)]);

  describe('GET /health', () => {
    it('returns only the overall status (200 when healthy)', async () => {
      const res = await request(healthy()).get('/health').expect(200);

      expect(res.body).toEqual({ status: 'healthy' });
    });

    it('returns 503 when a critical check is down, without dependency details', async () => {
      const app = buildApp([check('database', true, false), check('redis', true, true)]);

      const res = await request(app).get('/health').expect(503);

      expect(res.body).toEqual({ status: 'unhealthy' });
    });
  });

  describe.each(['/metrics', '/health/details'])('GET %s token guard', (path) => {
    it('returns 401 without a token', async () => {
      const res = await request(healthy()).get(path).expect(401);

      expect(res.body).toEqual(UNAUTHORIZED);
    });

    it('returns 401 with a wrong token', async () => {
      const res = await request(healthy())
        .get(path)
        .set('X-Internal-Token', 'w'.repeat(40))
        .expect(401);

      expect(res.body).toEqual(UNAUTHORIZED);
    });
  });

  it('GET /health/details returns the per-check report without connection strings', async () => {
    const app = buildApp([check('database', true, false), check('redis', true, true)]);

    const res = await request(app)
      .get('/health/details')
      .set('X-Internal-Token', TOKEN)
      .expect(503);

    expect(res.body).toMatchObject({
      status: 'unhealthy',
      service: 'auth',
      checks: {
        database: { status: 'down', critical: true },
        redis: { status: 'up', critical: true },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('GET /metrics returns the required Prometheus families with the token', async () => {
    const app = healthy();
    await request(app).post('/auth/login').send({});

    const res = await request(app)
      .get('/metrics')
      .set('X-Internal-Token', TOKEN)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('http_request_errors_total');
    expect(res.text).toMatch(/db_pool_connections\{[^}]*state="total"[^}]*\} 4/);
    expect(res.text).toContain('service="auth"');
  });

  it('counts error-handler responses in errors_total on the registry (no counter option needed)', async () => {
    const app = healthy();
    await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);

    const res = await request(app)
      .get('/metrics')
      .set('X-Internal-Token', TOKEN)
      .expect(200);

    expect(res.text).toMatch(
      /errors_total\{[^}]*source="http"[^}]*type="SyntaxError"[^}]*\} 1/,
    );
  });

  it('CORS allows and exposes the shared request-id header lists', async () => {
    const res = await request(healthy())
      .options('/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-request-id')
      .expect(204);

    expect(res.headers['access-control-allow-headers']).toBe(
      CORS_ALLOWED_HEADERS.join(','),
    );

    const exposed = await request(healthy())
      .get('/health')
      .set('Origin', 'http://localhost:3000');
    expect(exposed.headers['access-control-expose-headers']).toBe(
      CORS_EXPOSED_HEADERS.join(','),
    );
  });
});
