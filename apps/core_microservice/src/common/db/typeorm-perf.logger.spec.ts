import { Logger } from '@repo/shared';
import { currentQueryCount, runWithQueryContext } from './query-context';
import { TypeOrmPerfLogger } from './typeorm-perf.logger';

describe('TypeOrmPerfLogger', () => {
  const secret = 'super-secret-param';
  let fns: Record<keyof Logger, jest.Mock>;
  let logger: TypeOrmPerfLogger;

  beforeEach(() => {
    fns = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };
    logger = new TypeOrmPerfLogger(fns);
  });

  it('logQuery counts the query and prints nothing', () => {
    runWithQueryContext(() => {
      logger.logQuery();
      logger.logQuery();
      expect(currentQueryCount()).toBe(2);
    });
    Object.values(fns).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('logQueryError logs message and query but never the parameters', () => {
    (
      logger as unknown as {
        logQueryError: (...a: unknown[]) => void;
      }
    ).logQueryError(new Error('boom'), 'SELECT 1 WHERE a = $1', [secret]);

    expect(fns.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(fns.error.mock.calls);
    expect(logged).toContain('boom');
    expect(logged).toContain('SELECT 1 WHERE a = $1');
    expect(logged).not.toContain(secret);
  });

  it('logQuerySlow never logs parameters', () => {
    (
      logger as unknown as { logQuerySlow: (...a: unknown[]) => void }
    ).logQuerySlow(1000, 'SELECT 1', [secret]);

    expect(
      JSON.stringify(Object.values(fns).map((f): unknown => f.mock.calls)),
    ).not.toContain(secret);
  });

  it('delegates schema build, migration and log messages', () => {
    logger.logSchemaBuild('schema');
    logger.logMigration('migrated');
    logger.log('warn', 'careful');
    logger.log('info', 'fyi');

    expect(fns.debug).toHaveBeenCalledWith('schema');
    expect(fns.info).toHaveBeenCalledWith('migrated');
    expect(fns.warn).toHaveBeenCalledWith('careful');
    expect(fns.info).toHaveBeenCalledWith('fyi');
  });
});
