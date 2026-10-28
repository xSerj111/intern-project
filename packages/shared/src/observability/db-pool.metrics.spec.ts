import { Registry } from 'prom-client';
import { registerDbPoolGauge } from './db-pool.metrics';

describe('registerDbPoolGauge', () => {
  it('collects pool state on scrape', async () => {
    const registry = new Registry();
    const pool = { totalCount: 10, idleCount: 7, waitingCount: 1 };
    registerDbPoolGauge(registry, () => pool);
    let text = await registry.metrics();
    expect(text).toContain('db_pool_connections{state="total"} 10');
    expect(text).toContain('db_pool_connections{state="idle"} 7');
    expect(text).toContain('db_pool_connections{state="waiting"} 1');
    pool.waitingCount = 4;
    text = await registry.metrics();
    expect(text).toContain('db_pool_connections{state="waiting"} 4');
  });

  it('emits nothing while the pool is undefined', async () => {
    const registry = new Registry();
    registerDbPoolGauge(registry, () => undefined);
    expect(await registry.metrics()).not.toContain('db_pool_connections{');
  });
});
