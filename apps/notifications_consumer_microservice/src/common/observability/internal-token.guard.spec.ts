import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AppConfigService } from '../../config/app-config.service';
import { InternalTokenGuard } from './internal-token.guard';

const TOKEN = 't'.repeat(32);

const contextWith = (headers: Record<string, string>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as unknown as ExecutionContext;

describe('InternalTokenGuard', () => {
  const guard = new InternalTokenGuard({
    internalApiToken: TOKEN,
  } as AppConfigService);

  it('allows a matching token', () => {
    expect(guard.canActivate(contextWith({ 'x-internal-token': TOKEN }))).toBe(
      true,
    );
  });

  it('rejects a missing header with the plain 401 body', () => {
    expect.assertions(2);
    try {
      guard.canActivate(contextWith({}));
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
      });
    }
  });

  it.each(['wrong', 't'.repeat(31), 't'.repeat(33)])(
    'rejects a wrong token (%s)',
    (value) => {
      expect(() =>
        guard.canActivate(contextWith({ 'x-internal-token': value })),
      ).toThrow(UnauthorizedException);
    },
  );
});
