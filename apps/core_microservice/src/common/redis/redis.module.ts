import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';

export const REDIS_CLIENT = Symbol.for('REDIS_CLIENT');

/**
 * Shared ioredis client, used to check the access-token blacklist that
 * auth_microservice writes. Global because `JwtAuthGuard` is applied via
 * `@UseGuards` in many feature modules and each one must resolve the client.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis => {
        const client = new Redis({
          ...config.redis,
          // Fail fast instead of queueing forever, so an outage surfaces as 503.
          maxRetriesPerRequest: 1,
        });
        const logger = new Logger('Redis');
        client.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
