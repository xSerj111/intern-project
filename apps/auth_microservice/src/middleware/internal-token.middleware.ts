import { NextFunction, Request, Response } from 'express';
import {
  INTERNAL_TOKEN_HEADER,
  isValidInternalToken,
  UnauthorizedError,
  WinstonLogger,
} from '@repo/shared';
import { env } from '../config/env';

/**
 * Defence in depth for the internal listener: callers must present the shared
 * `INTERNAL_API_TOKEN`. The comparison is constant-time (shared helper).
 */
export function createInternalTokenMiddleware(
  logger: WinstonLogger,
  expectedToken: string = env.app.internalApiToken,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!isValidInternalToken(req.headers[INTERNAL_TOKEN_HEADER], expectedToken)) {
      logger.warn('Rejected internal request: missing or invalid X-Internal-Token', {
        props: { path: req.path },
      });
      next(new UnauthorizedError('Invalid internal token'));
      return;
    }

    next();
  };
}
