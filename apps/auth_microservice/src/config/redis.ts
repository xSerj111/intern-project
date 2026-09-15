import Redis from 'ioredis';
import { env } from './env';

export function createRedisClient(): Redis {
  return new Redis({
    host: env.redis.host,
    port: env.redis.port,
    password: env.redis.password,
  });
}
