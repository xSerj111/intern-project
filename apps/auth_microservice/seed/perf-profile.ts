/**
 * `--profile perf` for the auth seed: 1,000 users `perf0001@innogram.dev` …
 * with ids `seedId('user', n)` and one shared password (hashed once).
 *
 *   npm run db:seed -- --profile perf           # insert missing perf users
 *   npm run db:seed -- --profile perf --reset   # delete perf users first
 */
import bcrypt from 'bcrypt';
import type { Client } from 'pg';
import {
  PERF_BASE_DATE,
  PERF_PASSWORD,
  PERF_SEED_VERSION,
  insertChunked,
  perfEmail,
  perfUserId,
  perfUserNumbers,
} from '../../../seed/perf';

export async function seedPerfProfile(client: Client, reset: boolean): Promise<void> {
  const numbers = perfUserNumbers();
  const ids = numbers.map(perfUserId);
  const emails = numbers.map(perfEmail);

  if (reset) {
    // Sessions cascade from auth_users.
    const res = await client.query(
      'DELETE FROM auth_users WHERE id = ANY($1::uuid[]) OR email = ANY($2::text[])',
      [ids, emails],
    );
    console.log(`auth perf seed: ${res.rowCount ?? 0} perf users deleted`);
  }

  const passwordHash = await bcrypt.hash(PERF_PASSWORD, 10);
  const rows = numbers.map((n, i) => {
    const createdAt = new Date(PERF_BASE_DATE.getTime() - (400 * 24 * 60 - n) * 60_000);
    return [ids[i], emails[i], passwordHash, true, createdAt, createdAt];
  });

  const inserted = await insertChunked(
    client,
    'auth_users',
    ['id', 'email', 'passwordHash', 'isEmailVerified', 'createdAt', 'updatedAt'],
    rows,
  );

  console.log(
    `auth perf seed v${PERF_SEED_VERSION}: ${inserted} of ${rows.length} users inserted` +
      ` (password: ${PERF_PASSWORD})`,
  );
}
