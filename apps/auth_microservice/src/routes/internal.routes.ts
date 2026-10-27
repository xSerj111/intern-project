import { Router } from 'express';
import { isUUID } from 'class-validator';
import { EntityNotFoundError } from '@repo/shared';
import { IAuthUserRepository } from '../domain/interfaces/auth-user-repository.interface';

// Left out of the OpenAPI document (config/openapi.ts) on purpose: internal only.
export function createInternalRouter(userRepository: IAuthUserRepository): Router {
  const router = Router();

  router.get('/users/:id/contact', async (req, res, next) => {
    try {
      const { id } = req.params;
      // A malformed id can never match a row; skip the query (Postgres would reject the uuid).
      const user = isUUID(id) ? await userRepository.findOne({ id }) : null;
      if (!user) {
        throw new EntityNotFoundError('AuthUser', { id });
      }
      res.status(200).json({ userId: user.id, email: user.email });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
