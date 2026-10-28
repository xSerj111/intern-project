import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as dotenv from 'dotenv';
import type { Registry } from 'prom-client';
import { QUERY_COUNT_HEADER } from '../../src/common/perf/query-count.interceptor';
import type { Session } from './realtime.helpers';

/** `Authorization` header for a session returned by `registerAndLogin`/`login`. */
export const bearer = (session: Pick<Session, 'accessToken'>) => ({
  Authorization: `Bearer ${session.accessToken}`,
});

/** `X-Internal-Token` header from `INTERNAL_API_TOKEN` in the root `.env`. */
export function internalTokenHeader(): { 'X-Internal-Token': string } {
  let token = process.env.INTERNAL_API_TOKEN;
  if (!token) {
    try {
      const file = readFileSync(join(__dirname, '../../../../.env'));
      token = dotenv.parse(file).INTERNAL_API_TOKEN;
    } catch {
      /* no root .env: reported below */
    }
  }
  if (!token) {
    throw new Error('INTERNAL_API_TOKEN is not set (env or root .env)');
  }
  return { 'X-Internal-Token': token };
}

/** DB queries the request ran (needs `PERF_INSTRUMENTATION=true` on the app). */
export function dbQueryCount(res: {
  headers: Record<string, unknown>;
}): number {
  const raw = res.headers[QUERY_COUNT_HEADER.toLowerCase()];
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  const count = Number(value);
  if (typeof value !== 'string' || !Number.isInteger(count)) {
    throw new Error(
      `${QUERY_COUNT_HEADER} header missing or invalid (is PERF_INSTRUMENTATION=true?): ${String(value)}`,
    );
  }
  return count;
}

/**
 * Current value of the series `name{labels}` in a prom-client registry; labels
 * must match exactly. Returns 0 when the series has not been recorded yet.
 */
export async function metricValue(
  registry: Registry,
  name: string,
  labels: Record<string, string | number> = {},
): Promise<number> {
  const metric = registry.getSingleMetric(name);
  if (!metric) throw new Error(`metric "${name}" is not registered`);
  const { values } = await metric.get();
  const wanted = Object.entries(labels);
  const match = values.find((v) => {
    const have = v.labels ?? {};
    return (
      Object.keys(have).length === wanted.length &&
      wanted.every(([k, val]) => String(have[k]) === String(val))
    );
  });
  return match?.value ?? 0;
}
