import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { AccessTokenVerifier, RedisKeys } from '@repo/shared';
import { accessTokenVerifierProvider } from './access-token-verifier.provider';

type Factory = (config: ConfigService, redis: unknown) => AccessTokenVerifier;
const factory = (
  accessTokenVerifierProvider as unknown as { useFactory: Factory }
).useFactory;

const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const b64 = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Minimal HS256 JWT so the spec needs no JWT library of its own. */
const sign = (secret: string, jti = 'jti-1') => {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: 'user-1',
    email: 'a@b.c',
    jti,
    exp: Math.floor(Date.now() / 1000) + 300,
  })}`;
  const signature = createHmac('sha256', secret)
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
};

describe('accessTokenVerifierProvider', () => {
  const originalEnv = { ...process.env };
  let redis: { exists: jest.Mock };

  beforeEach(() => {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_SECRET;
    redis = { exists: jest.fn().mockResolvedValue(0) };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('throws when no secret is configured anywhere', () => {
    expect(() => factory(configWith({}), redis)).toThrow(
      'JWT access secret is not configured',
    );
  });

  it('prefers JWT_ACCESS_SECRET over JWT_SECRET', async () => {
    const verifier = factory(
      configWith({ JWT_ACCESS_SECRET: 'access', JWT_SECRET: 'legacy' }),
      redis,
    );

    expect((await verifier.verify(sign('access'))).ok).toBe(true);
    expect((await verifier.verify(sign('legacy'))).ok).toBe(false);
  });

  it('falls back to JWT_SECRET from the config', async () => {
    const verifier = factory(configWith({ JWT_SECRET: 'legacy' }), redis);

    expect((await verifier.verify(sign('legacy'))).ok).toBe(true);
  });

  it('falls back to process.env when the config has no value', async () => {
    process.env.JWT_SECRET = 'from-env';
    const verifier = factory(configWith({}), redis);

    expect((await verifier.verify(sign('from-env'))).ok).toBe(true);
  });

  it('uses JWT_ACCESS_SECRET from process.env before JWT_SECRET', async () => {
    process.env.JWT_ACCESS_SECRET = 'env-access';
    process.env.JWT_SECRET = 'env-legacy';
    const verifier = factory(configWith({}), redis);

    expect((await verifier.verify(sign('env-access'))).ok).toBe(true);
  });

  it('checks the access blacklist key and rejects a revoked token', async () => {
    redis.exists.mockResolvedValue(1);
    const verifier = factory(configWith({ JWT_SECRET: 's' }), redis);

    const result = await verifier.verify(sign('s', 'revoked-jti'));

    expect(redis.exists).toHaveBeenCalledWith(
      RedisKeys.accessBlacklist('revoked-jti'),
    );
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  it('reports unavailable when Redis fails (fail closed)', async () => {
    redis.exists.mockRejectedValue(new Error('redis down'));
    const verifier = factory(configWith({ JWT_SECRET: 's' }), redis);

    expect(await verifier.verify(sign('s'))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});
