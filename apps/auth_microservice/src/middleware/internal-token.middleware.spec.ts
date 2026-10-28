// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'a'.repeat(40);

import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import { UnauthorizedError, WinstonLogger } from '@repo/shared';
import { createInternalTokenMiddleware } from './internal-token.middleware';
import { createApp } from '../app';
import { RedisService } from '../infrastructure/cache/redis.service';

const TOKEN = 'a'.repeat(40);

describe('internal token middleware', () => {
  let logger: { warn: jest.Mock };
  let middleware: ReturnType<typeof createInternalTokenMiddleware>;

  const run = (headerValue?: string | string[]) => {
    const req = {
      headers: headerValue === undefined ? {} : { 'x-internal-token': headerValue },
      path: '/internal/users/1/contact',
    } as unknown as Request;
    const next = jest.fn() as unknown as NextFunction & jest.Mock;
    middleware(req, {} as Response, next);
    return next;
  };

  beforeEach(() => {
    logger = { warn: jest.fn() };
    middleware = createInternalTokenMiddleware(logger as unknown as WinstonLogger, TOKEN);
  });

  it('rejects a missing token with 401 and logs a warning', () => {
    const next = run();

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong token with 401 and logs a warning', () => {
    const next = run('b'.repeat(40));

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('does not throw on a token of a different length', () => {
    expect(() => run('short')).not.toThrow();
    expect(() => run(TOKEN + 'x')).not.toThrow();
    expect(run('short')).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('rejects a repeated header', () => {
    expect(run([TOKEN, TOKEN])).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('passes the correct token without an error or log', () => {
    const next = run(TOKEN);

    expect(next).toHaveBeenCalledWith();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('defaults to INTERNAL_API_TOKEN from env when no token is injected', () => {
    const defaulted = createInternalTokenMiddleware(logger as unknown as WinstonLogger);
    const call = (value: string) => {
      const next = jest.fn() as unknown as NextFunction & jest.Mock;
      defaulted(
        { headers: { 'x-internal-token': value }, path: '/x' } as unknown as Request,
        {} as Response,
        next,
      );
      return next;
    };

    expect(call(TOKEN)).toHaveBeenCalledWith();
    expect(call('b'.repeat(40))).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });

  it('compares with crypto.timingSafeEqual', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto') as typeof import('crypto');
    const spy = jest.spyOn(crypto, 'timingSafeEqual');

    run(TOKEN);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('public app', () => {
  it('does not serve /internal (404)', async () => {
    const dataSource = {
      getRepository: () => ({ metadata: { tableName: 'auth_users' } }),
    } as unknown as DataSource;
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as WinstonLogger;
    const app = createApp(
      dataSource,
      logger,
      {} as unknown as RedisService,
      { publish: jest.fn() } as unknown as Redis,
    );

    await request(app)
      .get('/internal/users/7c9e6679-7425-40de-944b-e07fc1f90ae7/contact')
      .set('X-Internal-Token', TOKEN)
      .expect(404);
  });
});
