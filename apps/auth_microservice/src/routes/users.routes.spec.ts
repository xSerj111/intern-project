// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

import express, { Application } from 'express';
import request from 'supertest';
import { UniqueConstraintViolationError } from '@repo/shared';
import type { WinstonLogger } from '@repo/shared';
import { createUsersRouter } from './users.routes';
import { UsersService } from '../services/users.service';
import { errorHandler } from '../middleware/error-handler.middleware';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { IAuthUserRepository } from '../domain/interfaces/auth-user-repository.interface';

describe('users routes', () => {
  let repository: { findByEmail: jest.Mock; save: jest.Mock };
  let crypto: { hash: jest.Mock; compare: jest.Mock };
  let publisher: { publishUserCreatedEvent: jest.Mock };
  let app: Application;

  beforeEach(() => {
    repository = {
      findByEmail: jest.fn().mockResolvedValue(null),
      save: jest
        .fn()
        .mockImplementation((user: AuthUser) =>
          Promise.resolve(Object.assign(user, { id: 'user-1' })),
        ),
    };
    crypto = {
      hash: jest.fn().mockResolvedValue('hashed-password'),
      compare: jest.fn(),
    };
    publisher = { publishUserCreatedEvent: jest.fn() };
    const logger = { debug: jest.fn(), warn: jest.fn() } as unknown as WinstonLogger;

    const usersService = new UsersService(
      repository as unknown as IAuthUserRepository,
      logger,
      crypto,
      publisher,
    );

    app = express();
    app.use(express.json());
    app.use('/users', createUsersRouter(usersService));
    app.use(errorHandler);
  });

  it('registers a user with 201 and never returns the password hash', async () => {
    const res = await request(app)
      .post('/users/register')
      .send({ email: 'new@user.com', password: 'password123' })
      .expect(201);

    expect(res.body).toMatchObject({ id: 'user-1', email: 'new@user.com' });
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(crypto.hash).toHaveBeenCalledWith('password123');
    expect(publisher.publishUserCreatedEvent).toHaveBeenCalledTimes(1);
  });

  it('a duplicate email is a 409 and nothing is saved', async () => {
    repository.findByEmail.mockResolvedValue({ id: 'user-0' });

    const res = await request(app)
      .post('/users/register')
      .send({ email: 'taken@user.com', password: 'password123' })
      .expect(409);

    expect((res.body as { error: string }).error).toBe(
      UniqueConstraintViolationError.name,
    );
    expect(repository.save).not.toHaveBeenCalled();
    expect(publisher.publishUserCreatedEvent).not.toHaveBeenCalled();
  });

  it('an invalid email is a 400 listing the validation message', async () => {
    const res = await request(app)
      .post('/users/register')
      .send({ email: 'not-an-email', password: 'password123' })
      .expect(400);

    expect((res.body as { message: string[] }).message).toContain(
      'Please provide a valid email address',
    );
    expect(repository.findByEmail).not.toHaveBeenCalled();
  });

  it('a short password is a 400', async () => {
    const res = await request(app)
      .post('/users/register')
      .send({ email: 'new@user.com', password: 'short' })
      .expect(400);

    expect((res.body as { message: string[] }).message).toContain(
      'Password must be at least 8 characters long',
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('an empty body is a 400', async () => {
    await request(app).post('/users/register').send({}).expect(400);
  });

  it('an unexpected service failure is a 500 without leaking details', async () => {
    repository.save.mockRejectedValue(new Error('connection reset'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(app)
      .post('/users/register')
      .send({ email: 'new@user.com', password: 'password123' })
      .expect(500);

    expect(JSON.stringify(res.body)).not.toContain('connection reset');
    consoleError.mockRestore();
  });
});
