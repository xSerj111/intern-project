/* eslint-disable @typescript-eslint/no-unsafe-member-access -- supertest payloads are untyped JSON */
import { createE2eApp, type E2eApp } from './helpers/app.helpers';
import { internalTokenHeader } from './helpers/api.helpers';

jest.setTimeout(60000);

/** Privileged port nothing listens on (see cache-outage.e2e-spec.ts). */
const CLOSED_PORT = '1';

/**
 * Cache Redis down: the optional dependency degrades the service but does not
 * make it unhealthy. Own file because createE2eApp applies one env set per
 * Jest worker.
 */
describe('Observability with the cache down (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await createE2eApp({
      CACHE_REDIS_HOST: '127.0.0.1',
      CACHE_REDIS_PORT: CLOSED_PORT,
    });
  });

  afterAll(async () => {
    await e2e.close();
  });

  it('reports degraded with cache_redis down, other checks up', async () => {
    const res = await e2e.http
      .get('/health/details')
      .set(internalTokenHeader())
      .expect(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.cache_redis).toMatchObject({
      status: 'down',
      critical: false,
    });
    expect(res.body.checks.database.status).toBe('up');
    expect(res.body.checks.session_redis.status).toBe('up');
  });

  it('keeps the public probe at 200 without leaking detail', async () => {
    const res = await e2e.http.get('/health').expect(200);
    expect(res.body).toEqual({ status: 'degraded' });
  });
});
