import express from 'express';
import request from 'supertest';
import {
  REQUEST_ID_HEADER,
  accessLogMiddleware,
  currentRequestId,
  requestIdMiddleware,
  runWithRequestContext,
} from './request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function buildApp() {
  const logger = { info: jest.fn(), error: jest.fn() };
  const app = express();
  app.use(requestIdMiddleware());
  app.use(accessLogMiddleware(logger));
  app.use(express.json());
  app.get('/ctx', (_req, res) => res.json({ id: currentRequestId() }));
  app.get('/async', async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await Promise.resolve();
    res.json({ id: currentRequestId() });
  });
  app.post('/body', (_req, res) => res.json({ id: currentRequestId() }));
  app.get('/posts/:id', (_req, res) => res.json({}));
  app.get('/boom', (_req, res) => res.status(503).json({}));
  app.get('/health', (_req, res) => res.json({}));
  app.get('/health/details', (_req, res) => res.json({}));
  app.get('/metrics', (_req, res) => res.send(''));
  return { app, logger };
}

describe('request context', () => {
  it('is empty outside a context and set inside runWithRequestContext', async () => {
    expect(currentRequestId()).toBeUndefined();
    const seen = await runWithRequestContext('abc', async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return currentRequestId();
    });
    expect(seen).toBe('abc');
    expect(currentRequestId()).toBeUndefined();
  });
});

describe('requestIdMiddleware', () => {
  it('accepts a valid incoming id and echoes it', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/ctx').set('X-Request-Id', 'e2e-123');
    expect(res.headers[REQUEST_ID_HEADER]).toBe('e2e-123');
    expect(res.body).toEqual({ id: 'e2e-123' });
  });

  it.each([
    ['missing', undefined],
    ['invalid characters', 'bad id;drop'],
    ['too long', 'a'.repeat(129)],
  ])('generates a UUID when the id is %s', async (_case, header) => {
    const { app } = buildApp();
    const req = request(app).get('/ctx');
    if (header) req.set('X-Request-Id', header);
    const res = await req;
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID);
    expect(res.body.id).toBe(res.headers[REQUEST_ID_HEADER]);
  });

  it('keeps the context across async continuations', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/async').set('X-Request-Id', 'async-1');
    expect(res.body).toEqual({ id: 'async-1' });
  });

  it('keeps the context after body parsing', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/body')
      .set('X-Request-Id', 'body-1')
      .send({ a: 1 });
    expect(res.body).toEqual({ id: 'body-1' });
  });

  it('isolates concurrent requests', async () => {
    const { app } = buildApp();
    const ids = Array.from({ length: 10 }, (_, i) => `req-${i}`);
    const results = await Promise.all(
      ids.map((id) => request(app).get('/async').set('X-Request-Id', id)),
    );
    expect(results.map((r) => r.body.id)).toEqual(ids);
  });
});

describe('accessLogMiddleware', () => {
  it('logs method, route template, status and duration with the request id', async () => {
    const { app, logger } = buildApp();
    await request(app)
      .get('/posts/42?token=secret')
      .set('X-Request-Id', 'log-1');

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [message, data] = logger.info.mock.calls[0];
    expect(message).toBe('GET /posts/:id 200');
    expect(data).toMatchObject({
      context: 'AccessLog',
      correlationId: 'log-1',
      props: { method: 'GET', route: '/posts/:id', status: 200 },
    });
    expect(typeof data.props.durationMs).toBe('number');
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/secret|42/);
  });

  it('logs 5xx at error level', async () => {
    const { app, logger } = buildApp();
    await request(app).get('/boom');
    expect(logger.error).toHaveBeenCalledWith(
      'GET /boom 503',
      expect.anything(),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('uses "unmatched" for requests no route handled', async () => {
    const { app, logger } = buildApp();
    await request(app).get('/nothing/secret-id');
    expect(logger.info).toHaveBeenCalledWith(
      'GET unmatched 404',
      expect.anything(),
    );
  });

  it.each(['/health', '/health/details', '/metrics', '/health?x=1'])(
    'skips %s',
    async (path) => {
      const { app, logger } = buildApp();
      await request(app).get(path);
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    },
  );
});
