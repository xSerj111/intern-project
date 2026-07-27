import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { UnauthorizedError, WinstonLogger } from '@repo/shared';
import { UsersService } from './users.service';
import { RedisService } from './redis.service';
import { jwtConfig } from '../config/jwt';
import { LoginDto } from '@repo/shared';
import { AuthUser } from '../entities/auth-user.entity';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: Omit<AuthUser, 'passwordHash'>;
}

export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
    private readonly logger: WinstonLogger,
  ) {}

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user) {
      this.logger.debug('Login failed: user not found', {
        props: { email: dto.email },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      this.logger.debug('Login failed: invalid password', {
        props: { userId: user.id },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    const accessToken = jwt.sign(
      { sub: user.id, email: user.email },
      jwtConfig.accessTokenSecret,
      { expiresIn: jwtConfig.accessTokenExpiry },
    );

    const refreshToken = jwtConfig.generateRefreshToken();

    const refreshTtlSeconds = this.parseExpiryToSeconds(
      jwtConfig.refreshTokenExpiry,
    );
    const redisKey = `refresh_token:${refreshToken}`;
    await this.redisService.setWithExpiry(
      redisKey,
      String(user.id),
      refreshTtlSeconds,
    );

    this.logger.debug('User logged in', { props: { userId: user.id } });

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
