import { ICryptoService } from '../domain/interfaces/crypto.service.interface';
import { RedisKeys, UnauthorizedError, WinstonLogger, secondsUntil } from '@repo/shared';
import { UsersService } from './users.service';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { ICacheService } from '../domain/interfaces/cache.service';
import {
  IJwtService,
  JwtPayload,
  RefreshTokenPayload,
} from '../domain/interfaces/jwt.service.interface';
import { SessionContext } from '../domain/interfaces/session-context';
import { IOAuthService } from '../domain/interfaces/oauth.service.interface';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: Omit<AuthUser, 'passwordHash'>;
}

export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly cacheService: ICacheService,
    private readonly logger: WinstonLogger,
    private readonly cryptoService: ICryptoService,
    private readonly jwtService: IJwtService,
    private readonly oauthService: IOAuthService,
  ) {}

  async login(email: string, password: string, ctx: SessionContext): Promise<LoginResult> {
    const user = await this.usersService.findByEmailWithPassword(email);

    if (!user || !user.passwordHash) {
      this.logger.debug('Login failed: user not found', {
        props: { email: email },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await this.cryptoService.compare(password, user.passwordHash);
    if (!isValid) {
      this.logger.debug('Login failed: invalid password', {
        props: { userId: user.id },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    this.logger.debug('User logged in', { props: { userId: user.id } });
    return this.generateTokensAndSession(user, ctx);
  }

  async loginWithGoogle(idToken: string, ctx: SessionContext): Promise<LoginResult> {
    try {
      const payload = await this.oauthService.verifyIdToken(idToken);

      const user = await this.usersService.findOrCreateByGoogle(
        payload.email,
        payload.sub,
      );

      this.logger.debug(`User logged in with Google`, {
        props: { userId: user.id },
      });

      return this.generateTokensAndSession(user, ctx);
    } catch (error) {
      this.logger.error('Google OAuth verification failed', { error });
      throw new UnauthorizedError('Invalid Google token');
    }
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verifyAccessToken(token);
    } catch (error) {
      throw new UnauthorizedError('Invalid or expired access token');
    }

    // Tokens issued before jti was introduced cannot be revoked, so reject them.
    if (!payload.jti) {
      throw new UnauthorizedError('Invalid or expired access token');
    }

    // Not wrapped in try/catch: if Redis is down the error propagates (fail closed).
    if (await this.cacheService.has(RedisKeys.accessBlacklist(payload.jti))) {
      throw new UnauthorizedError('Token has been revoked');
    }

    return payload;
  }

  async refreshToken(oldRefreshToken: string, ctx: SessionContext): Promise<LoginResult> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verifyRefreshToken(oldRefreshToken);
    } catch (error) {
      this.logger.debug('Refresh token failed: invalid or expired refresh token');
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    if (await this.cacheService.has(RedisKeys.refreshBlacklist(payload.jti))) {
      this.logger.warn('Refresh token reuse detected', {
        props: { userId: payload.sub, jti: payload.jti },
      });
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const sessionKey = RedisKeys.refreshSession(payload.jti);
    const rawSession = await this.cacheService.get(sessionKey);

    if (!rawSession) {
      this.logger.debug('Refresh token failed: session not found or expired in Redis');
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    let session: { userId?: string };
    try {
      session = JSON.parse(rawSession);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
    if (session.userId !== payload.sub) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    // DEL is atomic: if a concurrent refresh already claimed this session,
    // nothing is deleted and this request must not get a second token pair.
    if ((await this.cacheService.delete(sessionKey)) === 0) {
      this.logger.warn('Refresh token reuse detected (concurrent refresh)', {
        props: { userId: payload.sub, jti: payload.jti },
      });
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
    await this.revokeRefresh(payload.jti, payload.exp);

    const user = await this.usersService.getUserById(payload.sub);

    return this.generateTokensAndSession(user as AuthUser, ctx);
  }

  async logout(refreshToken: string, accessToken?: string): Promise<void> {
    let refresh: RefreshTokenPayload | null = null;
    try {
      refresh = this.jwtService.verifyRefreshToken(refreshToken);
    } catch {
      // An invalid or expired refresh token has nothing left to revoke.
    }

    if (refresh) {
      await this.cacheService.delete(RedisKeys.refreshSession(refresh.jti));
      await this.revokeRefresh(refresh.jti, refresh.exp);
      this.logger.debug('User logged out successfully, refresh token revoked');
    }

    if (!accessToken) return;

    let access: JwtPayload;
    try {
      access = this.jwtService.verifyAccessToken(accessToken);
    } catch {
      return; // Already invalid or expired, nothing to blacklist.
    }

    if (access.jti && access.exp) {
      const ttl = secondsUntil(access.exp);
      if (ttl > 0) {
        await this.cacheService.setWithExpiry(
          RedisKeys.accessBlacklist(access.jti),
          'true',
          ttl,
        );
      }
    }
  }

  private async revokeRefresh(jti: string, exp: number): Promise<void> {
    const ttl = secondsUntil(exp);
    if (ttl > 0) {
      await this.cacheService.setWithExpiry(RedisKeys.refreshBlacklist(jti), 'true', ttl);
    }
  }

  private async generateTokensAndSession(
    user: AuthUser,
    ctx: SessionContext,
  ): Promise<LoginResult> {
    const accessToken = this.jwtService.signAccessToken({
      sub: user.id,
      email: user.email,
    });

    const { token: refreshToken, jti, expiresAt } = this.jwtService.signRefreshToken(
      user.id,
    );

    await this.cacheService.setWithExpiry(
      RedisKeys.refreshSession(jti),
      JSON.stringify({
        userId: user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        expiresAt: expiresAt.toISOString(),
      }),
      secondsUntil(Math.floor(expiresAt.getTime() / 1000)),
    );

    const { passwordHash: _, ...safeUser } = user;
    return { accessToken, refreshToken, user: safeUser };
  }
}
