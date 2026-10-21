import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '@repo/shared';
import { requireAuth } from './auth.middleware';
import type { AuthService } from '../services/auth.service';

describe('requireAuth', () => {
  let authService: { verifyToken: jest.Mock };
  let middleware: ReturnType<typeof requireAuth>;

  const run = async (authorization?: string) => {
    const req = {
      headers: authorization === undefined ? {} : { authorization },
    } as unknown as Request;
    const next = jest.fn() as unknown as NextFunction & jest.Mock;
    await middleware(req, {} as Response, next);
    return { req, next };
  };

  beforeEach(() => {
    authService = { verifyToken: jest.fn() };
    middleware = requireAuth(authService as unknown as AuthService);
  });

  it('rejects a missing Authorization header with UnauthorizedError', async () => {
    const { next } = await run();

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it('rejects a non-Bearer scheme', async () => {
    const { next } = await run('Basic abc123');

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it('rejects "Bearer " with an empty token', async () => {
    const { next } = await run('Bearer ');

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it('rejects "Bearer" with no token part', async () => {
    const { next } = await run('Bearer');

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    expect(authService.verifyToken).not.toHaveBeenCalled();
  });

  it('forwards the error when the token is blacklisted', async () => {
    const revoked = new UnauthorizedError('Token has been revoked');
    authService.verifyToken.mockRejectedValue(revoked);

    const { req, next } = await run('Bearer revoked.jwt.token');

    expect(authService.verifyToken).toHaveBeenCalledWith('revoked.jwt.token');
    expect(next).toHaveBeenCalledWith(revoked);
    expect(req.user).toBeUndefined();
  });

  it('forwards infrastructure errors (e.g. Redis down) instead of passing', async () => {
    const down = new Error('redis unavailable');
    authService.verifyToken.mockRejectedValue(down);

    const { req, next } = await run('Bearer some.jwt.token');

    expect(next).toHaveBeenCalledWith(down);
    expect(req.user).toBeUndefined();
  });

  it('sets req.user and calls next() with no error for a valid token', async () => {
    const payload = { sub: 'user-1', email: 'a@b.c', jti: 'jti-1' };
    authService.verifyToken.mockResolvedValue(payload);

    const { req, next } = await run('Bearer valid.jwt.token');

    expect(authService.verifyToken).toHaveBeenCalledWith('valid.jwt.token');
    expect(req.user).toEqual(payload);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });
});
