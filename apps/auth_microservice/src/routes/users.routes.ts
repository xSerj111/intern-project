import { Router } from 'express';
import { UsersService } from '../services/users.service';
import { validateBody } from '../middleware/validate.middleware';
import { CreateUserDto } from '@repo/shared'; // Twój import DTO

export function createUsersRouter(usersService: UsersService): Router {
  const router = Router();

  router.post(
    '/register',
    validateBody(CreateUserDto),
    async (req, res, next) => {
      try {
        const result = await usersService.registerUser(req.body);
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await usersService.getUserById(req.params.id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
