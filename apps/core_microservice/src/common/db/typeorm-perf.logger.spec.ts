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

  describe('logQuerySlow', () => {
    const sentinel = 'sentinel.pii@example.com';
    const sql = 'SELECT id FROM users WHERE email = $1';
    type SlowFn = (...a: unknown[]) => void;
    const slow = () =>
      (logger as unknown as { logQuerySlow: SlowFn }).logQuerySlow;
    const props = () => {
      const [, data] = fns.warn.mock.calls[0] as [
        string,
        { props: Record<string, unknown> },
      ];
      return data.props;
    };

    it('warns with duration, a 12-hex queryId and the placeholder SQL, never the parameters', () => {
      slow().call(logger, 250, sql, [sentinel]);

      expect(fns.warn).toHaveBeenCalledTimes(1);
      expect((fns.warn.mock.calls[0] as unknown[])[0]).toBe('Slow query');
      expect(props().durationMs).toBe(250);
      expect(props().queryId).toMatch(/^[0-9a-f]{12}$/);
      expect(props().query).toBe(sql);
      expect(
        JSON.stringify(Object.values(fns).map((f) => f.mock.calls as unknown)),
      ).not.toContain(sentinel);
    });

    it('does not read the parameters argument at all', () => {
      const trap = new Proxy([], {
        get: () => {
          throw new Error('parameters were read');
        },
      });
      expect(() => {
        slow().call(logger, 250, sql, trap);
      }).not.toThrow();
    });

    it('gives the same queryId regardless of whitespace', () => {
      slow().call(logger, 250, sql);
      slow().call(
        logger,
        250,
        '  SELECT  id\n FROM\tusers   WHERE email = $1 ',
      );

      const ids = (fns.warn.mock.calls as unknown[][]).map(
        (c) => (c[1] as { props: { queryId: string } }).props.queryId,
      );
      expect(ids[0]).toBe(ids[1]);
    });

    it('truncates queries longer than 2 KB', () => {
      slow().call(logger, 250, 'SELECT ' + 'x'.repeat(5000));

      expect(String(props().query)).toHaveLength(2048);
    });
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
