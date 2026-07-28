import { Router } from 'express';
import { AuthService } from '../services/auth.service';
import { validateBody } from '../middleware/validate.middleware';
import { GoogleLoginDto, LoginDto } from '@repo/shared';

export function createAuthRouter(authService: AuthService): Router {
  const router = Router();

  /**
   * @openapi
   * /auth/login:
   *   post:
   *     summary: Authenticate user using email and password
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
   *       400:
   *         description: Bad Request (validation errors)
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

  /**
   * @openapi
   * /auth/google:
   *   post:
   *     summary: Authenticate or register user using Google ID Token
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [idToken]
   *             properties:
   *               idToken:
   *                 type: string
   *                 description: The JWT ID token issued by Google
   *     responses:
   *       200:
   *         description: Login successful
   *       400:
   *         description: Bad Request (missing token)
   *       401:
   *         description: Invalid or expired Google token
   */
  router.post(
    '/google',
    validateBody(GoogleLoginDto),
    async (req, res, next) => {
      try {
        const result = await authService.loginWithGoogle(req.body);
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
