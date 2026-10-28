import { Inject, Injectable } from '@nestjs/common';
import type { HealthCheck } from '@repo/shared';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

@Injectable()
export class SessionRedisCheck implements HealthCheck {
  readonly name = 'session_redis';
  readonly critical = true;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async run(): Promise<void> {
    await this.redis.ping();
  }
}
