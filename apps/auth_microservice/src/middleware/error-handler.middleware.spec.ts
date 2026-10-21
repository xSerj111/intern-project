import {
  AccessDeniedError,
  DomainError,
  DatabaseQueryError,
  EntityByIdNotFoundError,
  EntityNotFoundError,
  UnauthorizedError,
  UniqueConstraintViolationError,
} from '@repo/shared';
import { Request, Response } from 'express';
import { errorHandler } from './error-handler.middleware';

describe('errorHandler', () => {
  const run = (err: Error) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    errorHandler(err, {} as Request, { status } as unknown as Response, jest.fn());
    return { status, json };
  };

  it.each([
    ['EntityByIdNotFoundError', new EntityByIdNotFoundError('User', '1'), 404],
    ['EntityNotFoundError', new EntityNotFoundError('User', { a: 1 }), 404],
    ['AccessDeniedError', new AccessDeniedError(), 403],
    ['UnauthorizedError', new UnauthorizedError(), 401],
    [
      'UniqueConstraintViolationError',
      new UniqueConstraintViolationError('email', 'dup'),
      409,
    ],
    ['DatabaseQueryError', new DatabaseQueryError(), 500],
  ])('maps %s to %i', (_name, err, expected) => {
    const { status, json } = run(err);
    expect(status).toHaveBeenCalledWith(expected);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: expected, error: err.name }),
    );
  });

  it('maps a plain DomainError subclass without a specific mapping to 400', () => {
    class CustomDomainError extends DomainError {
      constructor() {
        super('custom rule broken');
      }
    }
    const { status, json } = run(new CustomDomainError());
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'CustomDomainError',
      message: 'custom rule broken',
    });
  });

  it('maps non-domain errors to 500 without leaking the message', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { status, json } = run(new Error('boom'));
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal Server Error',
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('boom');
    expect(spy).toHaveBeenCalledWith('Unhandled Server Error:', expect.any(Error));
    spy.mockRestore();
  });
});
