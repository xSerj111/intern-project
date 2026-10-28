/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { HEALTH_CHECKS } from '../src/common/observability/health.controller';
import { createE2eApp, type E2eApp } from './helpers/app.helpers';
import { bearer, internalTokenHeader } from './helpers/api.helpers';

jest.setTimeout(60000);

const UNAUTHORIZED = { statusCode: 401, message: 'Unauthorized' };
const CHECK_NAMES = [
  'database',
  'session_redis',
  'cache_redis',
  'broker',
  'object_storage',
];
const REQUIRED_FAMILIES = [
  'http_request_duration_seconds',
  'http_request_errors_total',
  'db_pool_connections',
  'cache_requests_total',
  'db_queries_per_request',
  'uploads_total',
];

/** Sum of `http_request_duration_seconds_count` over all series. */
function requestCount(metrics: string): number {
  return metrics
    .split('\n')
    .filter((l) => l.startsWith('http_request_duration_seconds_count'))
    .reduce((sum, l) => sum + Number(l.trim().split(' ').pop()), 0);
}

describe('Observability endpoints (e2e)', () => {
  let e2e: E2eApp;
  let http: E2eApp['http'];
  const token = () => internalTokenHeader();

  beforeAll(async () => {
    e2e = await createE2eApp();
    http = e2e.http;
  });

  afterAll(async () => {
    await e2e.close();
  });

  describe('GET /health', () => {
    it('is public and reveals only the overall status', async () => {
      const res = await http.get('/health').expect(200);
      expect(res.body).toEqual({ status: 'healthy' });
      const raw = JSON.stringify(res.body);
      for (const name of CHECK_NAMES) expect(raw).not.toContain(name);
    });
  });

  describe.each(['/health/details', '/metrics'])('GET %s', (path) => {
    it('rejects a missing token', async () => {
      const res = await http.get(path).expect(401);
      expect(res.body).toEqual(UNAUTHORIZED);
    });

    it('rejects a wrong token of any length', async () => {
      for (const wrong of ['x', 'x'.repeat(64), 'x'.repeat(500)]) {
        const res = await http
          .get(path)
          .set('X-Internal-Token', wrong)
          .expect(401);
        expect(res.body).toEqual(UNAUTHORIZED);
      }
    });
  });

  describe('GET /health/details', () => {
    it('reports the five core checks with the token', async () => {
      const res = await http.get('/health/details').set(token()).expect(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.service).toBe('core');
      expect(Number.isNaN(Date.parse(String(res.body.checkedAt)))).toBe(false);
      expect(Object.keys(res.body.checks).sort()).toEqual(
        [...CHECK_NAMES].sort(),
      );
      for (const name of CHECK_NAMES) {
        expect(res.body.checks[name]).toMatchObject({ status: 'up' });
      }
      expect(res.body.checks.database.critical).toBe(true);
      expect(res.body.checks.session_redis.critical).toBe(true);
      expect(res.body.checks.cache_redis.critical).toBe(false);
    });
  });

  describe('GET /metrics', () => {
    it('serves Prometheus text with the required families and service label', async () => {
      const res = await http.get('/metrics').set(token()).expect(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['content-type']).toContain('version=0.0.4');
      for (const family of REQUIRED_FAMILIES) {
        expect(res.text).toContain(`# TYPE ${family} `);
      }
      expect(res.text).toContain('service="core"');
      expect(res.text).toMatch(/db_pool_connections\{[^}]*state="total"/);
    });

    it('grows the request histogram count after traffic', async () => {
      const userId = randomUUID();
      const secret = process.env.JWT_ACCESS_SECRET ?? 'unused';
      const accessToken = jwt.sign(
        { sub: userId, email: `${userId}@test.local`, jti: randomUUID() },
        secret,
        { algorithm: 'HS256', expiresIn: '5m' },
      );
      const before = requestCount(
        (await http.get('/metrics').set(token()).expect(200)).text,
      );
      // Authenticated or not, every routed request is observed.
      await http.get('/profiles/me').set(bearer({ accessToken }));
      await http.get('/profiles/me');
      const after = requestCount(
        (await http.get('/metrics').set(token()).expect(200)).text,
      );
      expect(after).toBeGreaterThanOrEqual(before + 2);
    });
  });

  describe('X-Request-Id', () => {
    it('echoes an incoming id', async () => {
      const res = await http.get('/health').set('X-Request-Id', 'e2e-123');
      expect(res.headers['x-request-id']).toBe('e2e-123');
    });

    it('generates a UUID when none is sent', async () => {
      const res = await http.get('/health');
      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('a hanging dependency check', () => {
    let hanging: E2eApp;

    beforeAll(async () => {
      hanging = await createE2eApp({}, (builder) =>
        builder.overrideProvider(HEALTH_CHECKS).useValue([
          {
            name: 'stuck',
            critical: false,
            run: () => new Promise<void>(() => undefined),
          },
        ]),
      );
    });

    afterAll(async () => {
      await hanging.close();
    });

    it('still answers /health in under 2 s and reports degraded', async () => {
      const started = Date.now();
      const res = await hanging.http.get('/health').expect(200);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(res.body).toEqual({ status: 'degraded' });
    });

    it('marks the stuck check down with a timeout', async () => {
      const res = await hanging.http
        .get('/health/details')
        .set(token())
        .expect(200);
      expect(res.body.checks.stuck).toMatchObject({
        status: 'down',
        error: 'timeout',
      });
    });
  });
});
