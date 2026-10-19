import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AccessTokenVerifier, RedisKeys } from '@repo/shared';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'test-secret';

describe('JwtAuthGuard', () => {
  let redis: { exists: jest.Mock };
  let guard: JwtAuthGuard;

  const contextFor = (token?: string) => {
    const request: Record<string, unknown> = {
      headers: token ? { authorization: `Bearer ${token}` } : {},
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
    guard = new JwtAuthGuard(verifier);
  });

  it('lets a valid, non-blacklisted token through and attaches the payload', async () => {
    const { context, request } = contextFor(signToken());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redis.exists).toHaveBeenCalledWith('blacklist:access:jti-1');
    expect(request['user']).toMatchObject({ sub: 'user-1', jti: 'jti-1' });
  });

  it('rejects a blacklisted jti with 401', async () => {
    redis.exists.mockResolvedValue(1);
    const { context } = contextFor(signToken());

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Token has been revoked'),
    );
  });

  it('rejects a token without jti with 401', async () => {
    const { context } = contextFor(signToken({}));

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(redis.exists).not.toHaveBeenCalled();
  });

  it('answers 503 when Redis is unreachable', async () => {
    redis.exists.mockRejectedValue(new Error('ECONNREFUSED'));
    const { context } = contextFor(signToken());

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
