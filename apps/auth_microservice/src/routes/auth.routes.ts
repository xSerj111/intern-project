import { Request, Router } from 'express';
import { AuthService } from '../services/auth.service';
import { validateBody } from '../middleware/validate.middleware';
import { GoogleLoginDto, LoginDto } from '@repo/shared';
import { requireAuth } from '../middleware/auth.middleware';
import { RefreshTokenDto } from '@repo/shared';
import { SessionContext } from '../domain/interfaces/session-context';

const sessionContext = (req: Request): SessionContext => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
});

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
      const { email, password } = req.body as LoginDto;
      const result = await authService.login(email, password, sessionContext(req));
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
  router.post('/google', validateBody(GoogleLoginDto), async (req, res, next) => {
    try {
      const { idToken } = req.body as GoogleLoginDto;
      const result = await authService.loginWithGoogle(idToken, sessionContext(req));
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * components:
   *   securitySchemes:
   *     bearerAuth:
   *       type: http
   *       scheme: bearer
   *       bearerFormat: JWT
   *
   * /auth/me:
   *   get:
   *     summary: Get current authenticated user's payload
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Returns the user payload extracted from JWT
   *       401:
   *         description: Unauthorized (missing or invalid token)
   */
  router.get('/me', requireAuth(authService), (req, res) => {
    res.status(200).json({
      statusCode: 200,
      user: req.user,
    });
  });
  /**
   * @openapi
   * /auth/refresh:
   *   post:
   *     summary: Refresh access token
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RefreshTokenDto'
   *     responses:
   *       200:
   *         description: New tokens generated
   *       401:
   *         description: Invalid or expired refresh token
   */
  router.post('/refresh', validateBody(RefreshTokenDto), async (req, res, next) => {
    try {
      const { refreshToken } = req.body as RefreshTokenDto;
      const result = await authService.refreshToken(refreshToken, sessionContext(req));
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /auth/logout:
   *   post:
   *     summary: Logout user and revoke the refresh token (and the access token, when sent)
   *     description: >
   *       The Authorization bearer token is optional. When present and still valid,
   *       its jti is blacklisted until it expires.
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *       - {}
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/RefreshTokenDto'
   *     responses:
   *       200:
   *         description: Logged out successfully
   */
  router.post('/logout', validateBody(RefreshTokenDto), async (req, res, next) => {
    try {
      const { refreshToken } = req.body as RefreshTokenDto;
      // Optional: logout must still work when the access token has already expired.
      const [type, accessToken] = req.headers.authorization?.split(' ') ?? [];
      await authService.logout(refreshToken, type === 'Bearer' ? accessToken : undefined);
      res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
