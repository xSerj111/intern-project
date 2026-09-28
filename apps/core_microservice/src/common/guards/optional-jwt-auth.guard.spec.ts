import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  const secret = 'test-secret';
  const configService = {
    get: jest.fn(() => secret),
  } as unknown as ConfigService;

  function contextFor(headers: Record<string, string | undefined>) {
    const request = { headers };
    return {
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext,
      request,
    };
  }

  it('allows anonymous requests through without attaching a user', () => {
    const guard = new OptionalJwtAuthGuard(configService);
    const { context, request } = contextFor({});

    expect(guard.canActivate(context)).toBe(true);
    expect(request['user']).toBeUndefined();
  });

  it('attaches the verified payload when a valid token is present', () => {
    const token = jwt.sign({ sub: 'user-1' }, secret);
    const guard = new OptionalJwtAuthGuard(configService);
    const { context, request } = contextFor({
      authorization: `Bearer ${token}`,
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(request['user']).toMatchObject({ sub: 'user-1' });
  });

  it('rejects an invalid token', () => {
    const guard = new OptionalJwtAuthGuard(configService);
    const { context } = contextFor({ authorization: 'Bearer not-a-jwt' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
