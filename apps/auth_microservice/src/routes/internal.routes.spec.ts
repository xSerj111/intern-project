// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

import express, { Application } from 'express';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { INTERNAL_TOKEN_HEADER } from '@repo/shared';
import type { WinstonLogger } from '@repo/shared';
import { createInternalRouter } from './internal.routes';
import { createInternalApp } from '../app';
import { errorHandler } from '../middleware/error-handler.middleware';
import { IAuthUserRepository } from '../domain/interfaces/auth-user-repository.interface';

const USER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('internal routes', () => {
  let repository: { findOne: jest.Mock };
  let app: Application;

  beforeEach(() => {
    repository = { findOne: jest.fn() };
    app = express();
    app.use(
      '/internal',
      createInternalRouter(repository as unknown as IAuthUserRepository),
    );
    app.use(errorHandler);
  });

  it('returns only userId and email for a known user', async () => {
    repository.findOne.mockResolvedValue({
      id: USER_ID,
      email: 'a@b.com',
      passwordHash: 'secret',
      googleId: 'g-1',
    });

    const res = await request(app).get(`/internal/users/${USER_ID}/contact`).expect(200);

    expect(res.body).toEqual({ userId: USER_ID, email: 'a@b.com' });
    expect(repository.findOne).toHaveBeenCalledWith({ id: USER_ID });
  });

  it('an unknown user is a 404', async () => {
    repository.findOne.mockResolvedValue(null);

    const res = await request(app).get(`/internal/users/${USER_ID}/contact`).expect(404);

    expect((res.body as { statusCode: number }).statusCode).toBe(404);
  });

  it('a malformed id is a 404 and never queries the repository', async () => {
    await request(app).get('/internal/users/not-a-uuid/contact').expect(404);

    expect(repository.findOne).not.toHaveBeenCalled();
  });

  it('a repository failure is a 500', async () => {
    repository.findOne.mockRejectedValue(new Error('db down'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await request(app).get(`/internal/users/${USER_ID}/contact`).expect(500);

    consoleError.mockRestore();
  });
});

describe('internal app', () => {
  let findOne: jest.Mock;
  let app: Application;

  beforeEach(() => {
    findOne = jest.fn().mockResolvedValue({ id: USER_ID, email: 'a@b.com' });
    const dataSource = {
      getRepository: () => ({ metadata: { tableName: 'auth_users' }, findOne }),
    } as unknown as DataSource;
    const logger = { warn: jest.fn() } as unknown as WinstonLogger;
    app = createInternalApp(dataSource, logger);
  });

  it('rejects a request without the internal token', async () => {
    await request(app).get(`/internal/users/${USER_ID}/contact`).expect(401);

    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects a request with a wrong internal token', async () => {
    await request(app)
      .get(`/internal/users/${USER_ID}/contact`)
      .set(INTERNAL_TOKEN_HEADER, 'y'.repeat(32))
      .expect(401);
  });

  it('serves the contact with the right token and sends no CORS headers', async () => {
    const res = await request(app)
      .get(`/internal/users/${USER_ID}/contact`)
      .set('Origin', 'http://localhost:3000')
      .set(INTERNAL_TOKEN_HEADER, 'x'.repeat(32))
      .expect(200);

    expect(res.body).toEqual({ userId: USER_ID, email: 'a@b.com' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
