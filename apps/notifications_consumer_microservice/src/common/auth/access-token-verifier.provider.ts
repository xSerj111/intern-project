import { Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { AccessTokenVerifier, RedisKeys } from '@repo/shared';
import { AppConfigService } from '../../config/app-config.service';
import { REDIS_CLIENT } from '../redis/redis.module';

export const ACCESS_TOKEN_VERIFIER = Symbol.for('ACCESS_TOKEN_VERIFIER');

export const accessTokenVerifierProvider: Provider = {
  provide: ACCESS_TOKEN_VERIFIER,
  inject: [AppConfigService, REDIS_CLIENT],
  useFactory: (config: AppConfigService, redis: Redis): AccessTokenVerifier =>
    new AccessTokenVerifier(
      config.jwtSecret,
      async (jti) => (await redis.exists(RedisKeys.accessBlacklist(jti))) === 1,
    ),
};
