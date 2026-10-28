import type { DataSource } from 'typeorm';
import type { DbPoolStats, HealthCheck } from '@repo/shared';

/** Critical: auth cannot log anyone in without its database. */
export function createDatabaseCheck(dataSource: DataSource): HealthCheck {
  return {
    name: 'database',
    critical: true,
    run: async () => {
      await dataSource.query('SELECT 1');
    },
  };
}

/** The `pg` pool behind TypeORM's postgres driver, or undefined before it connects. */
export function getPgPool(dataSource: DataSource): DbPoolStats | undefined {
  const driver = dataSource.driver as { master?: Partial<DbPoolStats> } | undefined;
  const pool = driver?.master;
  if (!pool || typeof pool.totalCount !== 'number') return undefined;
  return pool as DbPoolStats;
}
