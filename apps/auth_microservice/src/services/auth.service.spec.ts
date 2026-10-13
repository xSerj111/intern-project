// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';

import { RedisKeys, UnauthorizedError, WinstonLogger } from '@repo/shared';
import { AuthService } from './auth.service';
import { UsersService } from './users.service';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { ICacheService } from '../domain/interfaces/cache.service';
import { ICryptoService } from '../domain/interfaces/crypto.service.interface';
import { IOAuthService } from '../domain/interfaces/oauth.service.interface';
import { JwtService } from '../infrastructure/jwt/jwt.service';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

/** In-memory ICacheService that remembers the TTL it was given per key. */
class FakeCache implements ICacheService {
  readonly store = new Map<string, { value: string; ttl: number }>();

  async get(key: string) {
    return this.store.get(key)?.value ?? null;
  }
  async setWithExpiry(key: string, value: string, ttlSeconds: number) {
    this.store.set(key, { value, ttl: ttlSeconds });
  }
  async delete(key: string) {
    return this.store.delete(key) ? 1 : 0;
  }
  async has(key: string) {
    return this.store.has(key);
  }
  async getOrSet(key: string, factory: () => Promise<string>, ttl: number) {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.setWithExpiry(key, value, ttl);
    return value;
  }
}

describe('AuthService', () => {
  const user = { id: 'user-1', email: 'a@b.com', passwordHash: 'hash' } as AuthUser;
  const ctx = { ipAddress: '10.0.0.1', userAgent: 'jest' };

  let cache: FakeCache;
  let jwtService: JwtService;
  let service: AuthService;
  let logger: { debug: jest.Mock; warn: jest.Mock; error: jest.Mock; info: jest.Mock };

  beforeEach(() => {
    cache = new FakeCache();
    jwtService = new JwtService();
    logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };

    const usersService = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(user),
      getUserById: jest.fn().mockResolvedValue(user),
    } as unknown as UsersService;
    const cryptoService: ICryptoService = {
      hash: jest.fn(),
      compare: jest.fn().mockResolvedValue(true),
    };
    const oauthService: IOAuthService = { verifyIdToken: jest.fn() };

    service = new AuthService(
      usersService,
      cache,
      logger as unknown as WinstonLogger,
      cryptoService,
      jwtService,
      oauthService,
    );
  });

  const jtiOf = (token: string) => (jwt.decode(token) as { jti: string }).jti;

  it('login stores a refresh session with all four fields and a TTL', async () => {
    const result = await service.login(user.email, 'password', ctx);

    const jti = jtiOf(result.refreshToken);
    const entry = cache.store.get(RedisKeys.refreshSession(jti));

    expect(entry).toBeDefined();
    expect(entry!.ttl).toBeGreaterThan(0);
    const session = JSON.parse(entry!.value);
    expect(session).toEqual({
      userId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      expiresAt: expect.any(String),
    });
    expect(new Date(session.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('refresh rotates: old session deleted, old id blacklisted, new session created', async () => {
    const first = await service.login(user.email, 'password', ctx);
    const oldJti = jtiOf(first.refreshToken);

    const second = await service.refreshToken(first.refreshToken, ctx);
    const newJti = jtiOf(second.refreshToken);

    expect(newJti).not.toBe(oldJti);
    expect(cache.store.has(RedisKeys.refreshSession(oldJti))).toBe(false);
    expect(cache.store.get(RedisKeys.refreshBlacklist(oldJti))?.value).toBe('true');
    expect(cache.store.has(RedisKeys.refreshSession(newJti))).toBe(true);
  });

  it('reusing a rotated refresh token is rejected and logged', async () => {
    const first = await service.login(user.email, 'password', ctx);
    await service.refreshToken(first.refreshToken, ctx);

    await expect(service.refreshToken(first.refreshToken, ctx)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('reuse detected'),
      expect.anything(),
    );
  });

  it('logout blacklists the access jti and verifyToken then rejects it', async () => {
    const { accessToken, refreshToken } = await service.login(user.email, 'password', ctx);
    await expect(service.verifyToken(accessToken)).resolves.toMatchObject({ sub: user.id });

    await service.logout(refreshToken, accessToken);

    const entry = cache.store.get(RedisKeys.accessBlacklist(jtiOf(accessToken)));
    expect(entry?.value).toBe('true');
    expect(entry!.ttl).toBeGreaterThan(0);
    expect(cache.store.has(RedisKeys.refreshSession(jtiOf(refreshToken)))).toBe(false);
    expect(cache.store.has(RedisKeys.refreshBlacklist(jtiOf(refreshToken)))).toBe(true);
    await expect(service.verifyToken(accessToken)).rejects.toThrow('Token has been revoked');
  });

  it('logout does not fail on an invalid refresh token', async () => {
    await expect(service.logout('garbage')).resolves.toBeUndefined();
  });

  it('verifyToken rejects an access token without jti', async () => {
    const token = jwt.sign({ sub: user.id, email: user.email }, env.jwt.accessTokenSecret, {
      expiresIn: 60,
    });

    await expect(service.verifyToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
