import { createHmac } from 'node:crypto';
import type { AppConfigService } from '../../config/app-config.service';
import { AccessTokenVerifier, RedisKeys } from '@repo/shared';
import { accessTokenVerifierProvider } from './access-token-verifier.provider';

type Factory = (
  config: AppConfigService,
  redis: unknown,
) => AccessTokenVerifier;
const factory = (
  accessTokenVerifierProvider as unknown as { useFactory: Factory }
).useFactory;

const configWith = (jwtSecret: string) =>
  ({ jwtSecret }) as unknown as AppConfigService;

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
  let redis: { exists: jest.Mock };

  beforeEach(() => {
    redis = { exists: jest.fn().mockResolvedValue(0) };
  });

  it('verifies tokens signed with the configured JWT secret', async () => {
    const verifier = factory(configWith('legacy'), redis);

    expect((await verifier.verify(sign('legacy'))).ok).toBe(true);
    expect((await verifier.verify(sign('other'))).ok).toBe(false);
  });

  it('checks the access blacklist key and rejects a revoked token', async () => {
    redis.exists.mockResolvedValue(1);
    const verifier = factory(configWith('s'), redis);

    const result = await verifier.verify(sign('s', 'revoked-jti'));

    expect(redis.exists).toHaveBeenCalledWith(
      RedisKeys.accessBlacklist('revoked-jti'),
    );
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  it('reports unavailable when Redis fails (fail closed)', async () => {
    redis.exists.mockRejectedValue(new Error('redis down'));
    const verifier = factory(configWith('s'), redis);

    expect(await verifier.verify(sign('s'))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});
