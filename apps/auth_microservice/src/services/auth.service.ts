import { ICryptoService } from '../domain/interfaces/crypto.service.interface';
import { UnauthorizedError, WinstonLogger } from '@repo/shared';
import { UsersService } from './users.service';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { ICacheService } from '../domain/interfaces/cache.service';
import { IJwtService, JwtPayload } from '../domain/interfaces/jwt.service.interface';
import { env } from '../config/env';
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

  async login(email: string, password: string): Promise<LoginResult> {
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
    return this.generateTokensAndSession(user);
  }

  async loginWithGoogle(idToken: string): Promise<LoginResult> {
    try {
      const payload = await this.oauthService.verifyIdToken(idToken);

      const user = await this.usersService.findOrCreateByGoogle(
        payload.email,
        payload.sub,
      );

      this.logger.debug(`User logged in with Google`, {
        props: { userId: user.id },
      });

      return this.generateTokensAndSession(user);
    } catch (error) {
      this.logger.error('Google OAuth verification failed', { error });
      throw new UnauthorizedError('Invalid Google token');
    }
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwtService.verifyAccessToken(token);
    } catch (error) {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  async refreshToken(oldRefreshToken: string): Promise<LoginResult> {
    const redisKey = `refresh_token:${oldRefreshToken}`;

    const userId = await this.cacheService.get(redisKey);

    if (!userId) {
      this.logger.debug('Refresh token failed: token not found or expired in Redis');
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const user = await this.usersService.getUserById(userId);

    await this.cacheService.delete(redisKey);

    return this.generateTokensAndSession(user as AuthUser);
  }

  async logout(refreshToken: string): Promise<void> {
    const redisKey = `refresh_token:${refreshToken}`;

    const deletedCount = await this.cacheService.delete(redisKey);

    if (deletedCount > 0) {
      this.logger.debug('User logged out successfully, refresh token removed');
    }
  }

  private async generateTokensAndSession(user: AuthUser): Promise<LoginResult> {
    const accessToken = this.jwtService.signAccessToken({
      sub: user.id,
      email: user.email,
    });

    const refreshToken = this.jwtService.generateRefreshToken();
    const refreshTtlSeconds = this.jwtService.parseExpiryToSeconds(
      env.jwt.refreshTokenExpiry,
    );

    const redisKey = `refresh_token:${refreshToken}`;
    await this.cacheService.setWithExpiry(redisKey, String(user.id), refreshTtlSeconds);

    const { passwordHash: _, ...safeUser } = user;
    return { accessToken, refreshToken, user: safeUser };
  }
}
