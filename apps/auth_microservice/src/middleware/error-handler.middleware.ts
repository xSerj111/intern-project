import {
  DomainError,
  EntityNotFoundError,
  EntityByIdNotFoundError,
  AccessDeniedError,
  UniqueConstraintViolationError,
  DatabaseQueryError,
  UnauthorizedError,
  WinstonLogger,
} from '@repo/shared';
import { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

export function createErrorHandler(logger: WinstonLogger): ErrorRequestHandler {
  return (
    err: Error,
    req: Request,
    res: Response,
    // Express identifies error middleware by its 4-argument arity, so `next` must stay.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required for Express arity
    next: NextFunction,
  ): void => {
    if (!(err instanceof DomainError)) {
      // Message + stack only: never the raw error object or the request body.
      // Nest-style (message, stack, context) puts the stack in its own field.
      logger.error(`Unhandled Server Error: ${err?.message}`, err?.stack, 'ErrorHandler');
      res.status(500).json({ statusCode: 500, message: 'Internal Server Error' });
      return;
    }

    sendDomainError(err, res);
  };
}

function sendDomainError(err: DomainError, res: Response): void {
  let status = 400;
  if (err instanceof EntityNotFoundError || err instanceof EntityByIdNotFoundError)
    status = 404;
  else if (err instanceof AccessDeniedError) status = 403;
  else if (err instanceof UniqueConstraintViolationError) status = 409;
  else if (err instanceof DatabaseQueryError) status = 500;
  else if (err instanceof UnauthorizedError) status = 401;

  res.status(status).json({
    statusCode: status,
    error: err.name,
    message: err.message,
  });
}
