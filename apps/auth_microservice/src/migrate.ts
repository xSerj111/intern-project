import { WinstonLogger } from '@repo/shared';
import { AppDataSource } from './config/database';

/**
 * One-shot container entrypoint (`node dist/migrate.js`): applies pending
 * migrations from `dist/migrations` through the app's own data source, then
 * exits 0, or 1 on any failure.
 */
async function migrate(): Promise<void> {
  const logger = new WinstonLogger('AuthMigrate');
  try {
    await AppDataSource.initialize();
    try {
      const applied = await AppDataSource.runMigrations({ transaction: 'each' });
      logger.info(
        applied.length
          ? `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`
          : 'No pending migrations',
      );
    } finally {
      await AppDataSource.destroy();
    }
    process.exit(0);
  } catch (err) {
    logger.error(err instanceof Error ? err : `Migration failed: ${String(err)}`);
    process.exit(1);
  }
}

void migrate();
