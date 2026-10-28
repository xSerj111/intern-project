import { Gauge, Registry } from 'prom-client';

export interface DbPoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

/**
 * Registers `db_pool_connections{state="total|idle|waiting"}`, read from the
 * pool on each scrape. Emits no series while the pool is unavailable.
 */
export function registerDbPoolGauge(
  registry: Registry,
  getPool: () => DbPoolStats | undefined,
): Gauge<'state'> {
  return new Gauge({
    name: 'db_pool_connections',
    help: 'Database pool connections by state',
    labelNames: ['state'],
    registers: [registry],
    collect() {
      const pool = getPool();
      if (!pool) return;
      this.set({ state: 'total' }, pool.totalCount);
      this.set({ state: 'idle' }, pool.idleCount);
      this.set({ state: 'waiting' }, pool.waitingCount);
    },
  });
}
