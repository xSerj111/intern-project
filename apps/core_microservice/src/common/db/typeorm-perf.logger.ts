import { Logger as TypeOrmLogger } from 'typeorm';
import { Logger, WinstonLogger } from '@repo/shared';
import { incrementQueryCount } from './query-context';

/**
 * TypeORM logger that counts queries per request and prints nothing for them.
 * Query `parameters` are never logged anywhere (they can hold user data).
 */
export class TypeOrmPerfLogger implements TypeOrmLogger {
  constructor(private readonly logger: Logger = new WinstonLogger('TypeOrm')) {}

  logQuery(): void {
    incrementQueryCount();
  }

  // Deliberately takes no `parameters` argument.
  logQueryError(error: string | Error, query: string): void {
    const message = error instanceof Error ? error.message : error;
    this.logger.error(`Query failed: ${message}`, { props: { query } });
  }

  // Filled in T060 (slow-query logging).
  logQuerySlow(): void {}

  logSchemaBuild(message: string): void {
    this.logger.debug(message);
  }

  logMigration(message: string): void {
    this.logger.info(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    const text = typeof message === 'string' ? message : String(message);
    if (level === 'warn') this.logger.warn(text);
    else this.logger.info(text);
  }
}
