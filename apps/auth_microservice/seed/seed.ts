/**
 * Dev seed for `innogram_auth`: inserts the mock users from `seed/fixtures.ts`.
 * Pair with `apps/core_microservice/seed/seed.ts`, which seeds their profiles.
 *
 *   npm run db:seed              # insert missing seed users
 *   npm run db:seed -- --reset   # delete seed users first, then insert
 *   npm run db:seed -- --profile perf [--reset]   # perf users instead (perf-profile.ts)
 */
import bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { Client } from 'pg';
import { SEED_PASSWORD, users } from '../../../seed/fixtures';
import { isPerfProfile } from '../../../seed/perf';
import { seedPerfProfile } from './perf-profile';

dotenv.config({ path: join(__dirname, '../../../.env') });

async function main() {
  const reset = process.argv.includes('--reset');
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    database: process.env.DB_NAME_AUTH || 'innogram_auth',
  });
  await client.connect();

  try {
    if (isPerfProfile()) return await seedPerfProfile(client, reset);

    const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
    const ids = users.map((u) => u.id);

    await client.query('BEGIN');
    if (reset) {
      await client.query('DELETE FROM auth_users WHERE id = ANY($1::uuid[])', [
        ids,
      ]);
    }
    let inserted = 0;
    for (const u of users) {
      const res = await client.query(
        `INSERT INTO auth_users (id, email, "passwordHash", "isEmailVerified")
         VALUES ($1, $2, $3, true)
         ON CONFLICT DO NOTHING`,
        [u.id, u.email, passwordHash],
      );
      inserted += res.rowCount ?? 0;
    }
    await client.query('COMMIT');

    console.log(
      `auth seed: ${inserted} of ${users.length} users inserted` +
        ` (password: ${SEED_PASSWORD})`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
