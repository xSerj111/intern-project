import type { Redis } from 'ioredis';
import type { HealthCheck } from '@repo/shared';

/** Critical: refresh sessions and the token blacklist live in Redis. */
export function createRedisCheck(client: Redis): HealthCheck {
  return {
    name: 'redis',
    critical: true,
    run: async () => {
      await client.ping();
    },
  };
}
