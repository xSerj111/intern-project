import { httpStatusFor, runHealthChecks } from './health-runner';

const ok = () => Promise.resolve();
class PgError extends Error {}
const fail = () =>
  Promise.reject(new PgError('connect postgres://u:p@host/db'));

describe('runHealthChecks', () => {
  it.each([
    ['all up', true, true, 'healthy'],
    ['non-critical down', true, false, 'degraded'],
    ['critical down', false, true, 'unhealthy'],
  ])('rolls up %s', async (_n, criticalUp, nonCriticalUp, expected) => {
    const report = await runHealthChecks('svc', [
      { name: 'db', critical: true, run: criticalUp ? ok : fail },
      { name: 'redis', critical: false, run: nonCriticalUp ? ok : fail },
    ]);
    expect(report.status).toBe(expected);
    expect(report.service).toBe('svc');
    expect(new Date(report.checkedAt).toISOString()).toBe(report.checkedAt);
  });

  it('reports a class name, never the message', async () => {
    const report = await runHealthChecks('svc', [
      { name: 'db', critical: true, run: fail },
    ]);
    expect(report.checks.db).toMatchObject({
      status: 'down',
      critical: true,
      error: 'PgError',
    });
    expect(JSON.stringify(report)).not.toContain('postgres://');
  });

  it('marks a hanging check down within the timeout budget', async () => {
    const startedAt = Date.now();
    const report = await runHealthChecks('svc', [
      { name: 'db', critical: true, run: ok },
      { name: 'rabbit', critical: false, run: () => new Promise(() => {}) },
    ]);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(1100);
    expect(report.checks.rabbit).toMatchObject({
      status: 'down',
      error: 'timeout',
    });
    expect(report.checks.db.status).toBe('up');
    expect(report.status).toBe('degraded');
  });

  it('honours a custom timeout', async () => {
    const report = await runHealthChecks(
      'svc',
      [{ name: 'x', critical: true, run: () => new Promise(() => {}) }],
      { timeoutMs: 20 },
    );
    expect(report.checks.x.error).toBe('timeout');
    expect(report.status).toBe('unhealthy');
  });

  it('is healthy with no checks', async () => {
    expect((await runHealthChecks('svc', [])).status).toBe('healthy');
  });
});

describe('httpStatusFor', () => {
  it('maps unhealthy to 503, else 200', () => {
    expect(httpStatusFor('unhealthy')).toBe(503);
    expect(httpStatusFor('degraded')).toBe(200);
    expect(httpStatusFor('healthy')).toBe(200);
  });
});
