import {
  AccessDeniedError,
  DomainError,
  DatabaseQueryError,
  EntityByIdNotFoundError,
  EntityNotFoundError,
  UnauthorizedError,
  UniqueConstraintViolationError,
} from '@repo/shared';
import type { WinstonLogger } from '@repo/shared';
import { Request, Response } from 'express';
import { createErrorHandler } from './error-handler.middleware';

describe('createErrorHandler', () => {
  let logger: { error: jest.Mock };
  let counter: { inc: jest.Mock };

  beforeEach(() => {
    logger = { error: jest.fn() };
    counter = { inc: jest.fn() };
  });

  const run = (err: Error, req: Partial<Request> = {}) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    createErrorHandler(logger as unknown as WinstonLogger, counter)(
      err,
      req as Request,
      { status } as unknown as Response,
      jest.fn(),
    );
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
    const { status, json } = run(new Error('boom'));
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal Server Error',
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('boom');
  });

  it('logs message and stack only, never the raw error or the request body', () => {
    const err = new Error('boom');
    run(err, { body: { password: 'secret-pass' } });

    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled Server Error: boom',
      err.stack,
      'ErrorHandler',
    );
    const args = logger.error.mock.calls[0] as unknown[];
    expect(args).not.toContain(err);
    expect(JSON.stringify(args)).not.toContain('secret-pass');
  });

  it('does not log domain errors', () => {
    run(new AccessDeniedError());
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('counts unknown errors as source=http with the class name as type', () => {
    class BoomError extends Error {}
    run(new BoomError('boom'));
    expect(counter.inc).toHaveBeenCalledTimes(1);
    expect(counter.inc).toHaveBeenCalledWith({ source: 'http', type: 'BoomError' });
  });

  it('does not count domain errors', () => {
    run(new AccessDeniedError());
    expect(counter.inc).not.toHaveBeenCalled();
  });

  it('maps malformed JSON to 400 without echoing the body, logging or counting', () => {
    const err = Object.assign(new SyntaxError('Unexpected token s in JSON'), {
      type: 'entity.parse.failed',
      body: '{"password":"secret-pass"',
    });
    const { status, json } = run(err);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ message: 'Malformed JSON body' });
    expect(JSON.stringify(json.mock.calls)).not.toContain('secret-pass');
    expect(logger.error).not.toHaveBeenCalled();
    expect(counter.inc).not.toHaveBeenCalled();
  });
});
