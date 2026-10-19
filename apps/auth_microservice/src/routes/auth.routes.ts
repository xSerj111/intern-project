import { CookieOptions, Request, Response, Router } from 'express';
import { AuthService, LoginResult } from '../services/auth.service';
import { validateBody } from '../middleware/validate.middleware';
import { GoogleLoginDto, LoginDto, UnauthorizedError } from '@repo/shared';
import { requireAuth } from '../middleware/auth.middleware';
import { SessionContext } from '../domain/interfaces/session-context';
import { env } from '../config/env';

export const REFRESH_COOKIE = 'refresh_token';

// Scoped to /auth so the refresh token only travels to login/refresh/logout,
// never to other auth routes or other services.
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.cookie.secure,
  sameSite: env.cookie.sameSite,
  path: '/auth',
};

const sessionContext = (req: Request): SessionContext => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
});

const readRefreshCookie = (req: Request): string | undefined => {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[
    REFRESH_COOKIE
  ];
  return typeof value === 'string' && value ? value : undefined;
};

/** Sets the refresh token as an httpOnly cookie; only the access token goes in the body. */
const sendSession = (res: Response, result: LoginResult): void => {
  const { refreshToken, refreshExpiresAt, ...body } = result;
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...refreshCookieOptions,
    maxAge: Math.max(0, refreshExpiresAt.getTime() - Date.now()),
  });
  res.status(200).json(body);
};

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
   *         description: >
   *           Login successful. Body carries `accessToken` and `user`; the refresh
   *           token is set as the httpOnly `refresh_token` cookie (path /auth).
   *       400:
   *         description: Bad Request (validation errors)
   *       401:
   *         description: Invalid credentials
   */
  router.post('/login', validateBody(LoginDto), async (req, res, next) => {
    try {
      const { email, password } = req.body as LoginDto;
      const result = await authService.login(email, password, sessionContext(req));
      sendSession(res, result);
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
   *         description: >
   *           Login successful. Body carries `accessToken` and `user`; the refresh
   *           token is set as the httpOnly `refresh_token` cookie (path /auth).
   *       400:
   *         description: Bad Request (missing token)
   *       401:
   *         description: Invalid or expired Google token
   */
  router.post('/google', validateBody(GoogleLoginDto), async (req, res, next) => {
    try {
      const { idToken } = req.body as GoogleLoginDto;
      const result = await authService.loginWithGoogle(idToken, sessionContext(req));
      sendSession(res, result);
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
   *     description: >
   *       Reads the refresh token from the httpOnly `refresh_token` cookie, rotates it
   *       (the cookie is replaced) and returns a new access token.
   *     tags: [Auth]
   *     parameters:
   *       - in: cookie
   *         name: refresh_token
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: New access token in the body, new refresh token in the cookie
   *       401:
   *         description: Missing, invalid or expired refresh token
   */
  router.post('/refresh', async (req, res, next) => {
    try {
      const refreshToken = readRefreshCookie(req);
      if (!refreshToken) {
        throw new UnauthorizedError('Missing refresh token');
      }
      const result = await authService.refreshToken(refreshToken, sessionContext(req));
      sendSession(res, result);
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
   *       Revokes the refresh token from the `refresh_token` cookie and clears the cookie.
   *       The Authorization bearer token is optional. When present and still valid,
   *       its jti is blacklisted until it expires.
   *     tags: [Auth]
   *     security:
   *       - bearerAuth: []
   *       - {}
   *     parameters:
   *       - in: cookie
   *         name: refresh_token
   *         required: false
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Logged out successfully
   */
  router.post('/logout', async (req, res, next) => {
    try {
      const refreshToken = readRefreshCookie(req);
      // Cleared up front so the browser drops it even if revocation fails.
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
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
