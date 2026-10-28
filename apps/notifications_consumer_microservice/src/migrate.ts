import { NestFactory } from '@nestjs/core';
import { WinstonLogger } from '@repo/shared';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';

/**
 * One-shot container entrypoint (`node dist/migrate.js`): applies pending
 * migrations from `dist/migrations`, then exits 0, or 1 on any failure.
 * Connection settings come from the app's validated config.
 */
async function migrate(): Promise<void> {
  const logger = new WinstonLogger('NotificationsMigrate');
  try {
    const ctx = await NestFactory.createApplicationContext(AppConfigModule, {
      logger: ['error', 'warn'],
    });
    const postgres = ctx.get(AppConfigService).postgres;
    await ctx.close();

    const dataSource = new DataSource({
      ...postgres,
      migrations: [join(__dirname, 'migrations/*.{ts,js}')],
    });
    await dataSource.initialize();
    try {
      const applied = await dataSource.runMigrations({ transaction: 'each' });
      logger.info(
        applied.length
          ? `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`
          : 'No pending migrations',
      );
    } finally {
      await dataSource.destroy();
    }
    process.exit(0);
  } catch (err) {
    logger.error(
      err instanceof Error ? err : `Migration failed: ${String(err)}`,
    );
    process.exit(1);
  }
}

void migrate();
