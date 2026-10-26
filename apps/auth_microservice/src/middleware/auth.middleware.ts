import { NextFunction, Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { UnauthorizedError } from '@repo/shared';

export function requireAuth(authService: AuthService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer')) {
        throw new UnauthorizedError('Missing or invalid Authorization header');
      }
      // Extract the bare token, skipping the "Bearer " prefix
      const token = authHeader.split(' ')[1];

      if (!token) {
        throw new UnauthorizedError('Token not found');
      }

      const payload = await authService.verifyToken(token);

      req.user = payload;

      next();
    } catch (error) {
      next(error);
    }
  };
}
