import type {
  HealthStatus,
  IHealthCheckResult,
  IHealthReport,
} from '@repo/contracts';

export interface HealthCheck {
  name: string;
  critical: boolean;
  run(): Promise<void>;
}

export interface HealthRunOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1000;

/** Short class name only: messages of driver errors may embed hosts or credentials. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.constructor.name || 'Error';
  return 'UnknownError';
}

async function runOne(
  check: HealthCheck,
  timeoutMs: number,
): Promise<IHealthCheckResult> {
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  try {
    await Promise.race([check.run(), timeout]);
    return {
      status: 'up',
      critical: check.critical,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.message === 'timeout';
    return {
      status: 'down',
      critical: check.critical,
      latencyMs: Date.now() - startedAt,
      error: timedOut ? 'timeout' : describeError(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rollup(results: IHealthCheckResult[]): HealthStatus {
  if (results.some((r) => r.status === 'down' && r.critical)) {
    return 'unhealthy';
  }
  if (results.some((r) => r.status === 'down')) return 'degraded';
  return 'healthy';
}

/**
 * Runs all checks in parallel, each raced against a timeout, and rolls the
 * results up: any critical down -> unhealthy, else any down -> degraded.
 */
export async function runHealthChecks(
  service: string,
  checks: HealthCheck[],
  { timeoutMs = DEFAULT_TIMEOUT_MS }: HealthRunOptions = {},
): Promise<IHealthReport> {
  const results = await Promise.all(checks.map((c) => runOne(c, timeoutMs)));
  const byName: Record<string, IHealthCheckResult> = {};
  checks.forEach((c, i) => {
    byName[c.name] = results[i];
  });
  return {
    status: rollup(results),
    service,
    checkedAt: new Date().toISOString(),
    checks: byName,
  };
}

export function httpStatusFor(status: HealthStatus): number {
  return status === 'unhealthy' ? 503 : 200;
}
