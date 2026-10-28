/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest payloads are untyped JSON */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  type DbPoolStats,
  DomainExceptionFilter,
  httpMetricsMiddleware,
  registerDbPoolGauge,
  type createMetricsRegistry,
} from '@repo/shared';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { METRICS_REGISTRY } from './../src/common/observability/metrics.tokens';
import { AppConfigService } from './../src/config/app-config.service';

jest.setTimeout(60000);

const UNAUTHORIZED = { statusCode: 401, message: 'Unauthorized' };

describe('Notifications observability (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Same http metrics and db pool gauge wiring as main.ts.
    const registry =
      app.get<ReturnType<typeof createMetricsRegistry>>(METRICS_REGISTRY);
    app.use(httpMetricsMiddleware(registry));
    const dataSource = app.get(DataSource);
    registerDbPoolGauge(
      registry,
      () => (dataSource.driver as unknown as { master?: DbPoolStats }).master,
    );
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.listen(0);
    http = request(app.getHttpServer());
    token = app.get(AppConfigService).internalApiToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('is public and returns only the overall status', async () => {
      const res = await http.get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: expect.stringMatching(/healthy|degraded/),
      });
    });
  });

  describe('GET /health/details', () => {
    it('rejects a missing token with the exact 401 body', async () => {
      const res = await http.get('/health/details');

      expect(res.status).toBe(401);
      expect(res.body).toEqual(UNAUTHORIZED);
    });

    it('rejects a wrong token (any length) with the same body', async () => {
      for (const wrong of ['x', 'y'.repeat(token.length), 'z'.repeat(200)]) {
        const res = await http
          .get('/health/details')
          .set('X-Internal-Token', wrong);

        expect(res.status).toBe(401);
        expect(res.body).toEqual(UNAUTHORIZED);
      }
    });

    it('returns the report with the notifications checks', async () => {
      const res = await http
        .get('/health/details')
        .set('X-Internal-Token', token);

      expect(res.status).toBe(200);
      expect(res.body.service).toBe('notifications');
      expect(res.body.status).toMatch(/healthy|degraded/);
      expect(Number.isNaN(Date.parse(res.body.checkedAt))).toBe(false);
      expect(Object.keys(res.body.checks).sort()).toEqual([
        'broker',
        'database',
        'session_redis',
        'smtp',
      ]);
      for (const name of ['database', 'session_redis', 'broker']) {
        expect(res.body.checks[name]).toMatchObject({
          status: 'up',
          critical: true,
        });
        expect(typeof res.body.checks[name].latencyMs).toBe('number');
      }
      expect(res.body.checks.smtp.critical).toBe(false);
      expect(['up', 'down']).toContain(res.body.checks.smtp.status);
    });
  });

  describe('GET /metrics', () => {
    it('rejects a missing or wrong token with the exact 401 body', async () => {
      const missing = await http.get('/metrics');
      const wrong = await http.get('/metrics').set('X-Internal-Token', 'nope');

      expect(missing.status).toBe(401);
      expect(missing.body).toEqual(UNAUTHORIZED);
      expect(wrong.status).toBe(401);
      expect(wrong.body).toEqual(UNAUTHORIZED);
    });

    it('serves Prometheus text with the required families', async () => {
      // An unauthenticated feed call yields a 4xx, so the error series exists.
      await http.get('/notifications').expect(401);

      const res = await http.get('/metrics').set('X-Internal-Token', token);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(
        'text/plain; version=0.0.4; charset=utf-8',
      );
      expect(res.text).toContain(
        '# TYPE http_request_duration_seconds histogram',
      );
      expect(res.text).toContain('# TYPE http_request_errors_total counter');
      expect(res.text).toContain('# TYPE db_pool_connections gauge');
      expect(res.text).toMatch(/^process_cpu_user_seconds_total\{/m);
      expect(res.text).toMatch(
        /^http_request_errors_total\{[^}]*service="notifications"/m,
      );
      expect(res.text).toMatch(/^db_pool_connections\{[^}]*state="/m);
      // Health and metrics probes are excluded from the http metrics.
      expect(res.text).not.toMatch(/route="\/(health|metrics)/);
    });
  });
});
