import { ExecutionContext } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AccessTokenVerifier, RedisKeys } from '@repo/shared';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

const SECRET = 'test-secret';

describe('OptionalJwtAuthGuard', () => {
  let redis: { exists: jest.Mock };
  let guard: OptionalJwtAuthGuard;

  const contextFor = (authorization?: string) => {
    const request: Record<string, unknown> = {
      headers: authorization ? { authorization } : {},
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const signToken = (options: jwt.SignOptions = { jwtid: 'jti-1' }) =>
    jwt.sign({ sub: 'user-1', email: 'a@b.com' }, SECRET, {
      expiresIn: 60,
      ...options,
    });

  beforeEach(() => {
    redis = { exists: jest.fn().mockResolvedValue(0) };
    const verifier = new AccessTokenVerifier(
      SECRET,
      async (jti) => (await redis.exists(RedisKeys.accessBlacklist(jti))) === 1,
    );
    guard = new OptionalJwtAuthGuard(verifier);
  });

  it('allows a request without a token and sets no user', async () => {
    const { context, request } = contextFor();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['user']).toBeUndefined();
    expect(redis.exists).not.toHaveBeenCalled();
  });

  it('attaches the payload for a valid token', async () => {
    const { context, request } = contextFor(`Bearer ${signToken()}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['user']).toMatchObject({ sub: 'user-1', jti: 'jti-1' });
  });

  it('treats an invalid token as anonymous', async () => {
    const { context, request } = contextFor('Bearer not-a-jwt');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['user']).toBeUndefined();
  });

  it('treats an expired token as anonymous', async () => {
    const { context, request } = contextFor(
      `Bearer ${signToken({ jwtid: 'jti-1', expiresIn: -10 })}`,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['user']).toBeUndefined();
  });

  it('treats a revoked token as anonymous', async () => {
    redis.exists.mockResolvedValue(1);
    const { context, request } = contextFor(`Bearer ${signToken()}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['user']).toBeUndefined();
  });

  it('treats an unavailable blacklist (Redis down) as anonymous', async () => {
    redis.exists.mockRejectedValue(new Error('redis down'));
    const { context, request } = contextFor(`Bearer ${signToken()}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['user']).toBeUndefined();
  });

  it('ignores a non-Bearer authorization header', async () => {
    const { context, request } = contextFor(`Basic ${signToken()}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request['user']).toBeUndefined();
  });
});
