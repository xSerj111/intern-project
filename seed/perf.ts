/**
 * Perf seed profile shared by `apps/auth_microservice/seed/perf-profile.ts`
 * and `apps/core_microservice/seed/perf-profile.ts` (`--profile perf`).
 *
 * Everything is deterministic: a fixed-seed PRNG, a fixed base date and ids
 * derived from `seedId(kind, n)`, so auth users and core profiles line up
 * without either seed touching the other's database, and two runs produce
 * identical rows.
 */
import { createHash } from 'crypto';

export const PERF_SEED_VERSION = 1;
export const PERF_PRNG_SEED = 20261020;
export const PERF_BASE_DATE = new Date('2026-01-01T00:00:00Z');
export const PERF_USER_COUNT = 1000;
export const PERF_EMAIL_DOMAIN = 'innogram.dev';
export const PERF_PASSWORD = 'PerfPassword123!';

/** mulberry32: tiny, fast, deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic RFC 4122 version-5-style UUID from sha1(`perf:${kind}:${n}`). */
export function seedId(kind: string, n: number): string {
  const hex = createHash('sha1').update(`perf:${kind}:${n}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

const pad4 = (n: number) => String(n).padStart(4, '0');

/** Perf users are numbered 1..PERF_USER_COUNT. */
export const perfEmail = (n: number): string =>
  `perf${pad4(n)}@${PERF_EMAIL_DOMAIN}`;

export const perfUsername = (n: number): string => `perf${pad4(n)}`;

export const perfUserId = (n: number): string => seedId('user', n);

/** 1..PERF_USER_COUNT */
export const perfUserNumbers = (): number[] =>
  Array.from({ length: PERF_USER_COUNT }, (_, i) => i + 1);

/** Minimal client shape so this file does not depend on `pg`. */
export interface PerfDb {
  query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null }>;
}

export const PERF_CHUNK_SIZE = 1000;

/**
 * Multi-row `INSERT … VALUES … ON CONFLICT DO NOTHING` in chunks of
 * PERF_CHUNK_SIZE rows, all inside one transaction. Returns rows inserted.
 */
export async function insertChunked(
  db: PerfDb,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<number> {
  const cols = columns.map((c) => `"${c}"`).join(', ');
  let inserted = 0;
  await db.query('BEGIN');
  try {
    for (let i = 0; i < rows.length; i += PERF_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + PERF_CHUNK_SIZE);
      const params: unknown[] = [];
      const tuples = chunk.map((row) => {
        const slots = row.map((value) => {
          params.push(value);
          return `$${params.length}`;
        });
        return `(${slots.join(', ')})`;
      });
      const res = await db.query(
        `INSERT INTO ${table} (${cols}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
        params,
      );
      inserted += res.rowCount ?? 0;
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
  return inserted;
}

/** True when argv contains `--profile perf` (or `--profile=perf`). */
export function isPerfProfile(argv: string[] = process.argv): boolean {
  const i = argv.indexOf('--profile');
  return (i >= 0 && argv[i + 1] === 'perf') || argv.includes('--profile=perf');
}
