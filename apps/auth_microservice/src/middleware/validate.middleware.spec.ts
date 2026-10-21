import 'reflect-metadata';
import { NextFunction, Request, Response } from 'express';
import { Type } from 'class-transformer';
import { IsEmail, IsString, MinLength, ValidateNested } from 'class-validator';
import { validateBody } from './validate.middleware';

class TestDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

class NestedDto {
  @ValidateNested()
  @Type(() => TestDto)
  child!: TestDto;
}

describe('validateBody', () => {
  const middleware = validateBody(TestDto);

  const run = async (body: unknown) => {
    const req = { body } as unknown as Request;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;
    const next = jest.fn() as unknown as NextFunction & jest.Mock;
    await middleware(req, res, next);
    return { req, status, json, next };
  };

  it('replaces req.body with a DTO instance and calls next() for a valid body', async () => {
    const { req, status, next } = await run({
      email: 'a@b.com',
      password: 'longenough',
    });

    expect(req.body).toBeInstanceOf(TestDto);
    expect(req.body).toMatchObject({ email: 'a@b.com', password: 'longenough' });
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
  });

  it('responds 400 with every constraint message and does not call next()', async () => {
    const { status, json, next } = await run({ email: 'nope', password: 'x' });

    expect(status).toHaveBeenCalledWith(400);
    const body = (json.mock.calls as unknown[][])[0][0] as { message: string[] };
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, error: 'Bad Request' }),
    );
    expect(body.message).toHaveLength(2);
    expect(body.message).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/email/),
        expect.stringMatching(/password/),
      ]),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 400 for an empty body object', async () => {
    const { status, next } = await run({});

    expect(status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('tolerates a failing property that reports no direct constraints', async () => {
    const middlewareNested = validateBody(NestedDto);
    const req = { body: { child: { email: 'bad' } } } as unknown as Request;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const next = jest.fn();

    await middlewareNested(req, { status } as unknown as Response, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: [] }));
    expect(next).not.toHaveBeenCalled();
  });
});
