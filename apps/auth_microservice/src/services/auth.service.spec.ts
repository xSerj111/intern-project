// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

import { RedisKeys, UnauthorizedError, WinstonLogger } from '@repo/shared';
import { AuthService } from './auth.service';
import { UsersService } from './users.service';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { ICacheService } from '../domain/interfaces/cache.service';
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
  let usersService: {
    findByEmailWithPassword: jest.Mock;
    getUserById: jest.Mock;
    findOrCreateByGoogle: jest.Mock;
  };
  let cryptoService: { hash: jest.Mock; compare: jest.Mock };
  let oauthService: { verifyIdToken: jest.Mock };

  beforeEach(() => {
    cache = new FakeCache();
    jwtService = new JwtService();
    logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };

    usersService = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(user),
      getUserById: jest.fn().mockResolvedValue(user),
      findOrCreateByGoogle: jest.fn().mockResolvedValue(user),
    };
    cryptoService = {
      hash: jest.fn(),
      compare: jest.fn().mockResolvedValue(true),
    };
    oauthService = { verifyIdToken: jest.fn() };
    publisher = {
      publish: jest.fn().mockImplementation(async () => {}),
    };

    service = new AuthService(
      usersService as unknown as UsersService,
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
    expect(result.refreshExpiresAt.toISOString()).toBe(session.expiresAt);
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

  it('logout without a refresh token still blacklists the access token', async () => {
    const { accessToken } = await service.login(user.email, 'password', ctx);

    await service.logout(undefined, accessToken);

    expect(cache.store.has(RedisKeys.accessBlacklist(jtiOf(accessToken)))).toBe(true);
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, jti: jtiOf(accessToken) }),
    );
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

  describe('login failures', () => {
    it('rejects an unknown email', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(null);

      await expect(service.login('x@y.com', 'pw', ctx)).rejects.toThrow(
        'Invalid email or password',
      );
      expect(cryptoService.compare).not.toHaveBeenCalled();
    });

    it('rejects a Google-only account that has no password hash', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue({
        ...user,
        passwordHash: null,
      });

      await expect(service.login(user.email, 'pw', ctx)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      expect(cache.store.size).toBe(0);
    });

    it('rejects a wrong password without creating a session', async () => {
      cryptoService.compare.mockResolvedValue(false);

      await expect(service.login(user.email, 'bad', ctx)).rejects.toThrow(
        'Invalid email or password',
      );
      expect(cryptoService.compare).toHaveBeenCalledWith('bad', user.passwordHash);
      expect(cache.store.size).toBe(0);
    });

    it('never returns the password hash', async () => {
      const result = await service.login(user.email, 'password', ctx);

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).toMatchObject({ id: user.id, email: user.email });
    });
  });

  describe('loginWithGoogle', () => {
    const googlePayload = { email: 'g@gmail.com', sub: 'google-sub-1' };

    beforeEach(() => {
      oauthService.verifyIdToken.mockResolvedValue(googlePayload);
    });

    it('creates a new user and returns a session for them', async () => {
      const created = {
        id: 'user-new',
        email: googlePayload.email,
        googleId: googlePayload.sub,
        passwordHash: null,
      } as unknown as AuthUser;
      usersService.findOrCreateByGoogle.mockResolvedValue(created);

      const result = await service.loginWithGoogle('id-token', ctx);

      expect(oauthService.verifyIdToken).toHaveBeenCalledWith('id-token');
      expect(usersService.findOrCreateByGoogle).toHaveBeenCalledWith(
        googlePayload.email,
        googlePayload.sub,
      );
      expect(result.user).toMatchObject({ id: 'user-new', email: googlePayload.email });
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(cache.store.has(RedisKeys.refreshSession(jtiOf(result.refreshToken)))).toBe(
        true,
      );
    });

    it('logs in an existing Google user', async () => {
      const existing = {
        id: 'user-google',
        email: googlePayload.email,
        googleId: googlePayload.sub,
      } as unknown as AuthUser;
      usersService.findOrCreateByGoogle.mockResolvedValue(existing);

      const result = await service.loginWithGoogle('id-token', ctx);

      expect((jwt.decode(result.accessToken) as { sub: string }).sub).toBe('user-google');
      expect(sidOf(result.accessToken)).toBe(sidOf(result.refreshToken));
    });

    it('logs in a password account linked to the Google identity', async () => {
      const linked = {
        ...user,
        email: googlePayload.email,
        googleId: googlePayload.sub,
      } as AuthUser;
      usersService.findOrCreateByGoogle.mockResolvedValue(linked);

      const result = await service.loginWithGoogle('id-token', ctx);

      expect(result.user).toMatchObject({ id: user.id, googleId: googlePayload.sub });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('maps a verification failure to UnauthorizedError', async () => {
      oauthService.verifyIdToken.mockRejectedValue(new Error('bad signature'));

      await expect(service.loginWithGoogle('bad', ctx)).rejects.toThrow(
        'Invalid Google token',
      );
      expect(usersService.findOrCreateByGoogle).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    it('maps a user lookup failure to UnauthorizedError', async () => {
      usersService.findOrCreateByGoogle.mockRejectedValue(new Error('db down'));

      await expect(service.loginWithGoogle('id-token', ctx)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      expect(cache.store.size).toBe(0);
    });
  });

  describe('verifyToken', () => {
    it('rejects a token signed with the wrong secret', async () => {
      const token = jwt.sign({ sub: user.id }, 'wrong-secret', { jwtid: 'j1' });

      await expect(service.verifyToken(token)).rejects.toThrow(
        'Invalid or expired access token',
      );
    });

    it('propagates a cache failure (fail closed)', async () => {
      const { accessToken } = await service.login(user.email, 'password', ctx);
      jest.spyOn(cache, 'has').mockRejectedValue(new Error('redis down'));

      await expect(service.verifyToken(accessToken)).rejects.toThrow('redis down');
    });
  });

  describe('refreshToken failures', () => {
    const signRefresh = (
      payload: object,
      opts: jwt.SignOptions = {},
      secret = env.jwt.refreshTokenSecret,
    ) => jwt.sign(payload, secret, { subject: user.id, jwtid: 'jti-x', ...opts });

    it('rejects an invalid token', async () => {
      await expect(service.refreshToken('garbage', ctx)).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });

    it('rejects an expired token', async () => {
      const expired = signRefresh({ exp: Math.floor(Date.now() / 1000) - 10 });

      await expect(service.refreshToken(expired, ctx)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      expect(usersService.getUserById).not.toHaveBeenCalled();
    });

    it('rejects a revoked (blacklisted) token and logs reuse', async () => {
      const { refreshToken } = await service.login(user.email, 'password', ctx);
      await cache.setWithExpiry(
        RedisKeys.refreshBlacklist(jtiOf(refreshToken)),
        'true',
        60,
      );

      await expect(service.refreshToken(refreshToken, ctx)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Refresh token reuse detected',
        expect.anything(),
      );
    });

    it('rejects a token whose session is gone', async () => {
      const token = signRefresh({}, { expiresIn: 60 });

      await expect(service.refreshToken(token, ctx)).rejects.toThrow(
        'Invalid or expired refresh token',
      );
    });

    it('rejects a corrupt session record', async () => {
      const token = signRefresh({}, { expiresIn: 60 });
      await cache.setWithExpiry(RedisKeys.refreshSession('jti-x'), '{not json', 60);

      await expect(service.refreshToken(token, ctx)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
    });

    it('rejects a session owned by a different user', async () => {
      const token = signRefresh({}, { expiresIn: 60 });
      await cache.setWithExpiry(
        RedisKeys.refreshSession('jti-x'),
        JSON.stringify({ userId: 'someone-else' }),
        60,
      );

      await expect(service.refreshToken(token, ctx)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      expect(cache.store.has(RedisKeys.refreshSession('jti-x'))).toBe(true);
    });

    it('rejects the loser of a concurrent refresh', async () => {
      const { refreshToken } = await service.login(user.email, 'password', ctx);
      jest.spyOn(cache, 'delete').mockResolvedValueOnce(0);

      await expect(service.refreshToken(refreshToken, ctx)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('concurrent refresh'),
        expect.anything(),
      );
      expect(usersService.getUserById).not.toHaveBeenCalled();
    });
  });

  describe('logout edge cases', () => {
    it('does nothing and publishes nothing without tokens', async () => {
      await service.logout();

      expect(cache.store.size).toBe(0);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('ignores an invalid access token', async () => {
      await service.logout(undefined, 'garbage');

      expect(cache.store.size).toBe(0);
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('publishes with the refresh sid and a null jti when only the refresh token is given', async () => {
      const { refreshToken } = await service.login(user.email, 'password', ctx);

      await service.logout(refreshToken);

      expect(publisher.publish).toHaveBeenCalledWith({
        userId: user.id,
        sid: sidOf(refreshToken),
        jti: null,
        revokedAt: expect.any(String) as string,
      });
    });

    it('skips the access blacklist for a token without jti', async () => {
      const token = jwt.sign({ sub: user.id }, env.jwt.accessTokenSecret, {
        expiresIn: 60,
      });

      await service.logout(undefined, token);

      expect(cache.store.size).toBe(0);
      expect(publisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, sid: null, jti: null }),
      );
    });
  });
});
