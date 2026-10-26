// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

import express, { Application } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcrypt';
import type { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import { UnauthorizedError } from '@repo/shared';
import type { WinstonLogger } from '@repo/shared';
import { createApp } from '../app';
import { RedisService } from '../infrastructure/cache/redis.service';
import { createAuthRouter, REFRESH_COOKIE } from './auth.routes';
import { AuthService, LoginResult } from '../services/auth.service';
import { createErrorHandler } from '../middleware/error-handler.middleware';

const setCookies = (res: request.Response): string[] => {
  const header = res.headers['set-cookie'] as unknown;
  if (Array.isArray(header)) return header as string[];
  return typeof header === 'string' ? [header] : [];
};

const refreshCookieOf = (res: request.Response) =>
  setCookies(res).find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`));

describe('auth routes', () => {
  const user = { id: 'user-1', email: 'a@b.com' } as LoginResult['user'];
  const session = (refreshToken: string): LoginResult => ({
    accessToken: 'access-token',
    refreshToken,
    refreshExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    user,
  });

  let authService: {
    login: jest.Mock;
    loginWithGoogle: jest.Mock;
    refreshToken: jest.Mock;
    logout: jest.Mock;
  };
  let app: Application;

  beforeEach(() => {
    authService = {
      login: jest.fn().mockResolvedValue(session('refresh-1')),
      loginWithGoogle: jest.fn().mockResolvedValue(session('refresh-g')),
      refreshToken: jest.fn().mockResolvedValue(session('refresh-2')),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/auth', createAuthRouter(authService as unknown as AuthService));
    app.use(createErrorHandler({ error: jest.fn() } as unknown as WinstonLogger));
  });

  it('login sets an httpOnly refresh cookie scoped to /auth and keeps it out of the body', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'password123' })
      .expect(200);

    expect(res.body).toEqual({ accessToken: 'access-token', user });
    const cookie = refreshCookieOf(res);
    expect(cookie).toContain(`${REFRESH_COOKIE}=refresh-1`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/auth');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  it('google login sets the refresh cookie the same way', async () => {
    const res = await request(app)
      .post('/auth/google')
      .send({ idToken: 'google-id-token' })
      .expect(200);

    expect(res.body).not.toHaveProperty('refreshToken');
    expect(refreshCookieOf(res)).toContain(`${REFRESH_COOKIE}=refresh-g`);
  });

  it('refresh reads the cookie and rotates it', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=refresh-1`)
      .expect(200);

    expect(authService.refreshToken).toHaveBeenCalledWith('refresh-1', expect.anything());
    expect(res.body).toEqual({ accessToken: 'access-token', user });
    expect(refreshCookieOf(res)).toContain(`${REFRESH_COOKIE}=refresh-2`);
  });

  it('refresh without the cookie is a 401 and never reaches the service', async () => {
    await request(app).post('/auth/refresh').expect(401);

    expect(authService.refreshToken).not.toHaveBeenCalled();
  });

  it('refresh ignores a refresh token sent in the body', async () => {
    await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'refresh-1' })
      .expect(401);
  });

  it('a rejected refresh is a 401', async () => {
    authService.refreshToken.mockRejectedValue(new UnauthorizedError('nope'));

    await request(app)
      .post('/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=stale`)
      .expect(401);
  });

  it('logout revokes the cookie token and the bearer token, and clears the cookie', async () => {
    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', `${REFRESH_COOKIE}=refresh-1`)
      .set('Authorization', 'Bearer access-token')
      .expect(200);

    expect(authService.logout).toHaveBeenCalledWith('refresh-1', 'access-token');
    const cookie = refreshCookieOf(res);
    expect(cookie).toContain(`${REFRESH_COOKIE}=;`);
    expect(cookie).toContain('Path=/auth');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('logout works without a cookie and still clears it', async () => {
    const res = await request(app).post('/auth/logout').expect(200);

    expect(authService.logout).toHaveBeenCalledWith(undefined, undefined);
    expect(refreshCookieOf(res)).toContain(`${REFRESH_COOKIE}=;`);
  });
});

describe('auth routes through createApp (mocked ports)', () => {
  const ORIGIN = 'http://localhost:3000';
  let app: Application;
  let setWithExpiry: jest.Mock;

  beforeEach(() => {
    const storedUser = {
      id: 'user-1',
      email: 'a@b.com',
      passwordHash: bcrypt.hashSync('password123', 4),
      googleId: null,
      isEmailVerified: true,
    };
    const dataSource = {
      getRepository: () => ({
        metadata: { tableName: 'auth_users' },
        findOne: jest.fn().mockResolvedValue(storedUser),
      }),
    } as unknown as DataSource;
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as WinstonLogger;
    setWithExpiry = jest.fn().mockResolvedValue(undefined);
    app = createApp(
      dataSource,
      logger,
      { setWithExpiry } as unknown as RedisService,
      { publish: jest.fn() } as unknown as Redis,
    );
  });

  const login = (origin?: string) => {
    const req = request(app)
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'password123' });
    return origin ? req.set('Origin', origin) : req;
  };

  it('the login body is exactly { accessToken, user } and the user has no password hash', async () => {
    const res = await login().expect(200);

    const body = res.body as { accessToken: string; user: object };
    expect(Object.keys(body).sort()).toEqual(['accessToken', 'user']);
    expect(typeof body.accessToken).toBe('string');
    expect(body.user).toMatchObject({ id: 'user-1', email: 'a@b.com' });
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('login sets a signed httpOnly refresh_token cookie on path /auth', async () => {
    const res = await login().expect(200);

    const cookie = refreshCookieOf(res);
    expect(cookie).toMatch(/^refresh_token=[\w-]+\.[\w-]+\.[\w-]+;/);
    expect(cookie).toContain('Path=/auth');
    expect(cookie).toContain('HttpOnly');
    expect(setWithExpiry).toHaveBeenCalled();
  });

  it('a wrong password is a 401 with no cookie and no tokens', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@b.com', password: 'wrong-password' })
      .expect(401);

    expect(refreshCookieOf(res)).toBeUndefined();
    expect(res.body).not.toHaveProperty('accessToken');
  });

  it('allows credentials for an origin listed in AUTH_ALLOWED_ORIGINS on the real response', async () => {
    const res = await login(ORIGIN).expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('preflight from an allowed origin permits credentials and the Authorization header', async () => {
    const res = await request(app)
      .options('/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
  });

  it('gives an origin outside the list no CORS grant', async () => {
    const res = await login('http://evil.test').expect(200);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refresh without the cookie is a 401 through the full app', async () => {
    await request(app).post('/auth/refresh').expect(401);
  });
});
