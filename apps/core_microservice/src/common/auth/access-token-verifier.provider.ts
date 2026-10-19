import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AccessTokenVerifier, RedisKeys } from '@repo/shared';
import { REDIS_CLIENT } from '../redis/redis.module';

export const ACCESS_TOKEN_VERIFIER = Symbol.for('ACCESS_TOKEN_VERIFIER');

export const accessTokenVerifierProvider: Provider = {
  provide: ACCESS_TOKEN_VERIFIER,
  inject: [ConfigService, REDIS_CLIENT],
  useFactory: (config: ConfigService, redis: Redis): AccessTokenVerifier => {
    // auth_microservice signs with JWT_SECRET; accept both names.
    const secret =
      config.get<string>('JWT_ACCESS_SECRET') ||
      config.get<string>('JWT_SECRET') ||
      process.env.JWT_ACCESS_SECRET ||
      process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT access secret is not configured on the server');
    }
    return new AccessTokenVerifier(
      secret,
      async (jti) => (await redis.exists(RedisKeys.accessBlacklist(jti))) === 1,
    );
  },
};
