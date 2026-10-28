import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { Counter, type Registry } from 'prom-client';
import { METRICS_REGISTRY } from '../observability/metrics.tokens';
import { cacheResourceOf } from './cache-keys';
import type { ICacheStore } from './cache-store.port';

export const CACHE_REDIS_CLIENT = Symbol.for('CACHE_REDIS_CLIENT');

const METRIC_NAME = 'cache_requests_total';
const WARN_INTERVAL_MS = 10_000;

type CacheResult = 'hit' | 'miss' | 'error';

/**
 * `ICacheStore` over the dedicated cache Redis (research §6–7). Every command
 * fails open: errors and timeouts become a miss / no-op, are counted as
 * `result="error"` and produce a rate-limited warn that never carries values.
 */
@Injectable()
export class RedisCacheAdapter implements ICacheStore {
  private readonly logger = new Logger('Cache');
  private readonly requests: Counter<'resource' | 'result'>;
  private lastWarnAt = 0;
  private suppressedWarns = 0;

  constructor(
    @Inject(CACHE_REDIS_CLIENT) private readonly client: Redis,
    @Inject(METRICS_REGISTRY) registry: Registry,
  ) {
    const existing = registry.getSingleMetric(METRIC_NAME);
    this.requests =
      (existing as Counter<'resource' | 'result'> | undefined) ??
      new Counter({
        name: METRIC_NAME,
        help: 'Cache lookups and failures by resource and result',
        labelNames: ['resource', 'result'],
        registers: [registry],
      });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (raw === null) {
        this.record(key, 'miss');
        return null;
      }
      const value = JSON.parse(raw) as T;
      this.record(key, 'hit');
      return value;
    } catch (err) {
      this.fail('get', key, err);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSec: number): Promise<void> {
    if (!Number.isInteger(ttlSec) || ttlSec <= 0) {
      throw new RangeError(
        `Cache TTL must be a positive integer, got ${ttlSec}`,
      );
    }
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
    } catch (err) {
      this.fail('set', key, err);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      this.fail('del', keys[0], err);
    }
  }

  private record(key: string, result: CacheResult): void {
    this.requests.inc({ resource: cacheResourceOf(key), result });
  }

  private fail(op: string, key: string, err: unknown): void {
    this.record(key, 'error');
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) {
      this.suppressedWarns++;
      return;
    }
    const suppressed = this.suppressedWarns
      ? ` (${this.suppressedWarns} suppressed)`
      : '';
    this.lastWarnAt = now;
    this.suppressedWarns = 0;
    const reason = err instanceof Error ? err.message : 'unknown error';
    this.logger.warn(
      `Cache ${op} failed for ${cacheResourceOf(key)}, serving without cache: ${reason}${suppressed}`,
    );
  }
}
