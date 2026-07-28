export interface ICacheService {
  get(key: string): Promise<string | null>;
  setWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<number>;
  has(key: string): Promise<boolean>;
  getOrSet(
    key: string,
    factory: () => Promise<string>,
    ttlSeconds: number,
  ): Promise<string>;
}
