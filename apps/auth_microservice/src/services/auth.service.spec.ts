// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

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

  get(key: string) {
    return Promise.resolve(this.store.get(key)?.value ?? null);
  }
  setWithExpiry(key: string, value: string, ttlSeconds: number) {
    this.store.set(key, { value, ttl: ttlSeconds });
    return Promise.resolve();
  }
  delete(key: string) {
    return Promise.resolve(this.store.delete(key) ? 1 : 0);
  }
  has(key: string) {
    return Promise.resolve(this.store.has(key));
  }
  async getOrSet(key: string, factory: () => Promise<string>, ttl: number) {
    const cached = await this.get(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.setWithExpiry(key, value, ttl);
    return value;
  }
}

interface SessionJson {
  userId: string;
  sid: string;
  expiresAt: string;
}

describe('AuthService', () => {
  const user = { id: 'user-1', email: 'a@b.com', passwordHash: 'hash' } as AuthUser;
  const ctx = { ipAddress: '10.0.0.1', userAgent: 'jest' };

  let cache: FakeCache;
  let jwtService: JwtService;
  let service: AuthService;
  let publisher: { publish: jest.Mock };
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
    publisher = {
      publish: jest.fn().mockImplementation(async () => {}),
    };

    service = new AuthService(
      usersService,
      cache,
      logger as unknown as WinstonLogger,
      cryptoService,
      jwtService,
      oauthService,
      publisher,
    );
  });

  const jtiOf = (token: string) => (jwt.decode(token) as { jti: string }).jti;

  it('login stores a refresh session with all four fields and a TTL', async () => {
    const result = await service.login(user.email, 'password', ctx);

    const jti = jtiOf(result.refreshToken);
    const entry = cache.store.get(RedisKeys.refreshSession(jti));

    expect(entry).toBeDefined();
    expect(entry!.ttl).toBeGreaterThan(0);
    const session = JSON.parse(entry!.value) as SessionJson;
    expect(session).toEqual({
      userId: user.id,
      sid: expect.any(String) as string,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      expiresAt: expect.any(String) as string,
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
    const { accessToken, refreshToken } = await service.login(
      user.email,
      'password',
      ctx,
    );
    await expect(service.verifyToken(accessToken)).resolves.toMatchObject({
      sub: user.id,
    });

    await service.logout(refreshToken, accessToken);

    const entry = cache.store.get(RedisKeys.accessBlacklist(jtiOf(accessToken)));
    expect(entry?.value).toBe('true');
    expect(entry!.ttl).toBeGreaterThan(0);
    expect(cache.store.has(RedisKeys.refreshSession(jtiOf(refreshToken)))).toBe(false);
    expect(cache.store.has(RedisKeys.refreshBlacklist(jtiOf(refreshToken)))).toBe(true);
    await expect(service.verifyToken(accessToken)).rejects.toThrow(
      'Token has been revoked',
    );
  });

  const sidOf = (token: string) => (jwt.decode(token) as { sid?: string }).sid;

  it('login puts the same sid in both tokens and the session record', async () => {
    const { accessToken, refreshToken } = await service.login(
      user.email,
      'password',
      ctx,
    );
    const sid = sidOf(accessToken);

    expect(sid).toEqual(expect.any(String));
    expect(sidOf(refreshToken)).toBe(sid);
    const session = JSON.parse(
      cache.store.get(RedisKeys.refreshSession(jtiOf(refreshToken)))!.value,
    ) as SessionJson;
    expect(session.sid).toBe(sid);
  });

  it('refresh keeps the sid', async () => {
    const first = await service.login(user.email, 'password', ctx);
    const second = await service.refreshToken(first.refreshToken, ctx);

    expect(sidOf(second.accessToken)).toBe(sidOf(first.accessToken));
    expect(sidOf(second.refreshToken)).toBe(sidOf(first.accessToken));
    const session = JSON.parse(
      cache.store.get(RedisKeys.refreshSession(jtiOf(second.refreshToken)))!.value,
    ) as SessionJson;
    expect(session.sid).toBe(sidOf(first.accessToken));
  });

  it('logout publishes once, after blacklisting, with the right sid and jti', async () => {
    const { accessToken, refreshToken } = await service.login(
      user.email,
      'password',
      ctx,
    );
    publisher.publish.mockImplementation(() => {
      expect(cache.store.has(RedisKeys.accessBlacklist(jtiOf(accessToken)))).toBe(true);
      expect(cache.store.has(RedisKeys.refreshBlacklist(jtiOf(refreshToken)))).toBe(true);
      return Promise.resolve();
    });

    await service.logout(refreshToken, accessToken);

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith({
      userId: user.id,
      sid: sidOf(accessToken),
      jti: jtiOf(accessToken),
      revokedAt: expect.any(String) as string,
    });
  });

  it('a publisher failure does not fail logout', async () => {
    const { accessToken, refreshToken } = await service.login(
      user.email,
      'password',
      ctx,
    );
    publisher.publish.mockRejectedValue(new Error('redis down'));

    await expect(service.logout(refreshToken, accessToken)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('logout does not fail on an invalid refresh token', async () => {
    await expect(service.logout('garbage')).resolves.toBeUndefined();
  });

  it('verifyToken rejects an access token without jti', async () => {
    const token = jwt.sign(
      { sub: user.id, email: user.email },
      env.jwt.accessTokenSecret,
      {
        expiresIn: 60,
      },
    );

    await expect(service.verifyToken(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
