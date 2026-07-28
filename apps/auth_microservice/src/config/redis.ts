import Redis from 'ioredis';
import { env } from './env';

export function createRedisClient(): Redis {
  const redisUrl = env.redis.url;
  return new Redis(redisUrl);
}
