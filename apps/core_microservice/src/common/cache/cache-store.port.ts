/** Resource label carried by `cache_requests_total{resource}`. */
export type CacheResource = 'profile' | 'follow_counts' | 'signed_url';

/**
 * Cache-aside store. Implementations fail open: `get` returns `null` and
 * `set`/`del` resolve on any store error, so a cache outage never becomes a
 * request error (FR-018).
 */
export interface ICacheStore {
  get<T>(key: string): Promise<T | null>;
  /** `ttlSec` must be a positive integer; anything else is a programming error and throws. */
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
}

export const CACHE_STORE = Symbol.for('ICacheStore');
