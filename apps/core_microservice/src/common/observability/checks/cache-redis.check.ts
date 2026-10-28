import { Inject, Injectable } from '@nestjs/common';
import type { HealthCheck } from '@repo/shared';
import Redis from 'ioredis';
import { CACHE_REDIS_CLIENT } from '../../cache/redis-cache.adapter';

@Injectable()
export class CacheRedisCheck implements HealthCheck {
  readonly name = 'cache_redis';
  readonly critical = false;

  constructor(@Inject(CACHE_REDIS_CLIENT) private readonly redis: Redis) {}

  async run(): Promise<void> {
    // Not ready: skip the command (the client has no offline queue and a
    // command would only reject anyway), and report the outage directly.
    if (this.redis.status !== 'ready') throw new Error('not ready');
    await this.redis.ping();
  }
}
