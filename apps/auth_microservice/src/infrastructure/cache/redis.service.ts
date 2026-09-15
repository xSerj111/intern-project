import { WinstonLogger } from '@repo/shared';
import { Redis } from 'ioredis';
import { ICacheService } from '../../domain/interfaces/cache.service';

export class RedisService implements ICacheService {
  constructor(
    private readonly client: Redis,
    private readonly logger: WinstonLogger,
  ) {
    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    this.client.on('connect', () => this.logger.info('Redis connected'));
    this.client.on('error', (err: Error) =>
      this.logger.error('Redis error', { error: err }),
    );
    this.client.on('reconnecting', () =>
      this.logger.warn('Redis reconnecting...'),
    );
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async setWithExpiry(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async delete(key: string): Promise<number> {
    return this.client.del(key);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async has(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async getOrSet(
    key: string,
    factory: () => Promise<string>,
    ttlSeconds: number,
  ): Promise<string> {
    const cached = await this.client.get(key);
    if (cached !== null) {
      return cached;
    }
    const value = await factory();
    await this.client.set(key, value, 'EX', ttlSeconds);
    return value;
  }
}
