import jwt from 'jsonwebtoken';
import { ICryptoService } from '../infrastructure/crypto/crypto.service';
import { GoogleLoginDto, UnauthorizedError, WinstonLogger } from '@repo/shared';
import { UsersService } from './users.service';
import { RedisService } from '../infrastructure/cache/redis.service';
import { jwtConfig } from '../config/jwt';
import { LoginDto } from '@repo/shared';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { OAuth2Client } from 'google-auth-library';
import { googleConfig } from '../config/google';
import { ICacheService } from '../domain/interfaces/cache.service';

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
      const client = new OAuth2Client(googleConfig.clientId);
      const ticket = await client.verifyIdToken({
        idToken: idToken,
        audience: googleConfig.clientId,
      });

      const payload = ticket.getPayload();

      if (!payload || !payload.email || !payload.sub) {
        throw new UnauthorizedError('Invalid Google token payload');
      }

      const user = await this.usersService.findOrCreateByGoogle(
        payload.email,
        payload.sub,
      );
      this.logger.debug('User logged in with Google', {
        props: { userId: user.id },
      });

      return this.generateTokensAndSession(user);
    } catch (error) {
      this.logger.error('Google OAuth verification failed', { error });
      throw new UnauthorizedError('Invalid Google token');
    }
  }

  private async generateTokensAndSession(user: AuthUser): Promise<LoginResult> {
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email },
      jwtConfig.accessTokenSecret,
      { expiresIn: jwtConfig.accessTokenExpiry as any },
    );

    const refreshToken = jwtConfig.generateRefreshToken();
    const refreshTtlSeconds = this.parseExpiryToSeconds(jwtConfig.refreshTokenExpiry);

    const redisKey = `refresh_token:${refreshToken}`;
    await this.cacheService.setWithExpiry(redisKey, String(user.id), refreshTtlSeconds);

    const { passwordHash: _, ...safeUser } = user;
    return { accessToken, refreshToken, user: safeUser };
  }

  private parseExpiryToSeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 604800; // 7 days default

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return value * (multipliers[unit] || 1);
  }
}
