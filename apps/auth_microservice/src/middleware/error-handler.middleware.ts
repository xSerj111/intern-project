import {
  DomainError,
  EntityNotFoundError,
  UniqueConstraintViolationError,
  DatabaseQueryError,
} from '@repo/shared';
import { NextFunction, Request, Response } from 'express';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!(err instanceof DomainError)) {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ statusCode: 500, message: 'Internal Server Error' });
    return;
  }

  let status = 400;
  if (err instanceof EntityNotFoundError) status = 404;
  else if (err instanceof UniqueConstraintViolationError) status = 409;
  else if (err instanceof DatabaseQueryError) status = 500;

  res.status(status).json({
    statusCode: status,
    error: err.name,
    message: err.message,
  });
}
