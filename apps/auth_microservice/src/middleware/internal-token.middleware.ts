import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError, WinstonLogger } from '@repo/shared';
import { env } from '../config/env';

export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/**
 * Defence in depth for the internal listener: callers must present the shared
 * `INTERNAL_API_TOKEN`. The comparison is constant-time.
 */
export function createInternalTokenMiddleware(
  logger: WinstonLogger,
  expectedToken: string = env.app.internalApiToken,
) {
  const expected = Buffer.from(expectedToken);

  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers[INTERNAL_TOKEN_HEADER];
    const provided = typeof header === 'string' ? Buffer.from(header) : undefined;

    // timingSafeEqual throws on different lengths, so guard first.
    if (
      !provided ||
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      logger.warn('Rejected internal request: missing or invalid X-Internal-Token', {
        props: { path: req.path },
      });
      next(new UnauthorizedError('Invalid internal token'));
      return;
    }

    next();
  };
}
