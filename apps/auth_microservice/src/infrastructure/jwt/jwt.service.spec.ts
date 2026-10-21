// env.ts fails fast on these at import time, so set them before anything loads it.
process.env.CORE_SERVICE_URL = 'http://localhost:3001';
process.env.AUTH_ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.INTERNAL_API_TOKEN = 'x'.repeat(32);

import jwt from 'jsonwebtoken';
import { JwtService } from './jwt.service';
import { env } from '../../config/env';

describe('JwtService', () => {
  const service = new JwtService();
  const payload = { sub: 'user-1', email: 'a@b.com' } as Parameters<
    JwtService['signAccessToken']
  >[0];

  afterEach(() => jest.useRealTimers());

  describe('access tokens', () => {
    it('round-trips the payload and stamps a unique jti and expiry', () => {
      const token = service.signAccessToken(payload);
      const decoded = service.verifyAccessToken(token) as unknown as Record<
        string,
        unknown
      >;

      expect(decoded).toMatchObject({ sub: 'user-1', email: 'a@b.com' });
      expect(decoded.jti).toEqual(expect.any(String));
      expect(decoded.exp).toEqual(expect.any(Number));
      const other = jwt.decode(service.signAccessToken(payload)) as { jti: string };
      expect(other.jti).not.toBe(decoded.jti);
    });

    it('rejects a token signed with a different secret', () => {
      const forged = jwt.sign(payload, 'wrong-secret', { expiresIn: 60 });

      expect(() => service.verifyAccessToken(forged)).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects a refresh token presented as an access token', () => {
      const { token } = service.signRefreshToken('user-1');

      expect(() => service.verifyAccessToken(token)).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects an expired token', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const token = service.signAccessToken(payload);
      jest.setSystemTime(new Date('2026-01-02T00:00:00Z'));

      expect(() => service.verifyAccessToken(token)).toThrow(jwt.TokenExpiredError);
    });

    it('rejects garbage input', () => {
      expect(() => service.verifyAccessToken('not-a-jwt')).toThrow(jwt.JsonWebTokenError);
    });
  });

  describe('refresh tokens', () => {
    it('signs with subject, jti, sid and an expiry matching the configured lifetime', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { token, jti, expiresAt } = service.signRefreshToken('user-1', 'sid-1');
      const lifetimeMs = service.parseExpiryToSeconds(env.jwt.refreshTokenExpiry) * 1000;

      expect(expiresAt.getTime()).toBe(Date.now() + lifetimeMs);
      expect(service.verifyRefreshToken(token)).toEqual({
        sub: 'user-1',
        jti,
        exp: Math.floor(expiresAt.getTime() / 1000),
        sid: 'sid-1',
      });
    });

    it('omits sid when none is given', () => {
      const { token } = service.signRefreshToken('user-1');

      expect(service.verifyRefreshToken(token).sid).toBeUndefined();
    });

    it('rejects a token signed with a different secret', () => {
      const forged = jwt.sign({}, 'wrong-secret', {
        subject: 'user-1',
        jwtid: 'j1',
        expiresIn: 60,
      });

      expect(() => service.verifyRefreshToken(forged)).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects an access token presented as a refresh token', () => {
      const token = service.signAccessToken(payload);

      expect(() => service.verifyRefreshToken(token)).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects an expired token', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { token } = service.signRefreshToken('user-1');
      jest.setSystemTime(new Date('2026-03-01T00:00:00Z'));

      expect(() => service.verifyRefreshToken(token)).toThrow(jwt.TokenExpiredError);
    });

    it.each([
      ['subject', { jwtid: 'j1' }],
      ['jti', { subject: 'user-1' }],
    ])('rejects a validly signed token missing %s as malformed', (_name, opts) => {
      const token = jwt.sign({}, env.jwt.refreshTokenSecret, {
        expiresIn: 60,
        ...opts,
      });

      expect(() => service.verifyRefreshToken(token)).toThrow('Malformed refresh token');
    });

    it('rejects a validly signed token without exp as malformed', () => {
      const token = jwt.sign({}, env.jwt.refreshTokenSecret, {
        subject: 'user-1',
        jwtid: 'j1',
      });

      expect(() => service.verifyRefreshToken(token)).toThrow('Malformed refresh token');
    });
  });

  describe('parseExpiryToSeconds', () => {
    it.each([
      ['30s', 30],
      ['15m', 900],
      ['2h', 7200],
      ['7d', 604800],
    ])('converts %s to %i seconds', (expiry, seconds) => {
      expect(service.parseExpiryToSeconds(expiry)).toBe(seconds);
    });

    it.each(['', 'abc', '7', '7w', '-5m'])(
      'falls back to 7 days for malformed value %p',
      (expiry) => {
        expect(service.parseExpiryToSeconds(expiry)).toBe(604800);
      },
    );
  });
});
