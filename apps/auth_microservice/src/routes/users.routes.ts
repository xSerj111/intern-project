import { Router } from 'express';
import { UsersService } from '../services/users.service';
import { validateBody } from '../middleware/validate.middleware';
import { CreateUserDto } from '@repo/shared'; // DTO import

export function createUsersRouter(usersService: UsersService): Router {
  const router = Router();

  router.post('/register', validateBody(CreateUserDto), async (req, res, next) => {
    try {
      const { email, password } = req.body as CreateUserDto;
      const result = await usersService.registerUser(email, password);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
