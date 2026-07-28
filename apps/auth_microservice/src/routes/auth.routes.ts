import { Router } from 'express';
import { AuthService } from '../services/auth.service';
import { validateBody } from '../middleware/validate.middleware';
import { LoginDto } from '@repo/shared';

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  /**
   * @openapi
   * /auth/login:
   *   post:
   *     summary: Authenticate user and return tokens
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [email, password]
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *               password:
   *                 type: string
   *                 minLength: 8
   *     responses:
   *       200:
   *         description: Login successful
   *       401:
   *         description: Invalid credentials
   */
  router.post('/login', validateBody(LoginDto), async (req, res, next) => {
    try {
      const result = await authService.login(req.body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
