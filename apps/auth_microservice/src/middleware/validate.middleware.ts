import { NextFunction, Request, Response } from 'express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export function validateBody<T extends object>(dtoClass: new () => T) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const dtoInstance = plainToInstance(dtoClass, req.body);

    const errors = await validate(dtoInstance);

    if (errors.length > 0) {
      const messages = errors
        .map((err) => Object.values(err.constraints || {}))
        .flat();
      res.status(400).json({
        statusCode: 400,
        error: 'Bad Request',
        message: messages,
      });
      return;
    }

    req.body = dtoInstance;
    next();
  };
}
