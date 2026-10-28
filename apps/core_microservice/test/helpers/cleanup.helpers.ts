import { DataSource } from 'typeorm';
import { registeredUserIds } from './realtime.helpers';

/**
 * Best-effort removal of what an e2e file created for `userIds` (default: every
 * user `registerAndLogin` made in this file).
 *
 * core: every chat the users belong to or created (participants, messages and
 * message_assets cascade), their follows and uploaded assets, then the profiles.
 * auth: sessions and users, over a short-lived connection to the auth database
 * with the core connection's credentials (override the name with DB_NAME_AUTH).
 *
 * Never throws: a failing step is skipped and returned (and warned about).
 * Asset rows go too, so delete their storage objects first if the suite stored any.
 */
export async function cleanupE2eData(
  core: DataSource,
  userIds: string[] = [...registeredUserIds],
): Promise<string[]> {
  const ids = [...new Set(userIds)];
  const failures: string[] = [];
  if (ids.length === 0) return failures;

  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      failures.push(
        `${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  await step('core', async () => {
    await core.query(
      `DELETE FROM chats WHERE "createdById" = ANY($1::uuid[])
         OR id IN (SELECT "chatId" FROM chat_participants WHERE "userId" = ANY($1::uuid[]))`,
      [ids],
    );
    await core.query(
      'DELETE FROM follows WHERE "followerId" = ANY($1::uuid[]) OR "followingId" = ANY($1::uuid[])',
      [ids],
    );
    await core.query(
      'DELETE FROM assets WHERE "uploaderId" = ANY($1::uuid[])',
      [ids],
    );
    await core.query(
      'DELETE FROM user_profiles WHERE "authUserId" = ANY($1::uuid[])',
      [ids],
    );
  });

  await step('auth', async () => {
    const auth = new DataSource({
      ...core.options,
      type: 'postgres',
      database: process.env.DB_NAME_AUTH || 'innogram_auth',
      entities: [],
      migrations: [],
      synchronize: false,
    } as ConstructorParameters<typeof DataSource>[0]);
    await auth.initialize();
    try {
      await auth.query(
        'DELETE FROM auth_sessions WHERE "userId" = ANY($1::uuid[])',
        [ids],
      );
      await auth.query('DELETE FROM auth_users WHERE id = ANY($1::uuid[])', [
        ids,
      ]);
    } finally {
      await auth.destroy();
    }
  });

  if (failures.length > 0) {
    console.warn(`e2e cleanup left data behind: ${failures.join('; ')}`);
  }
  return failures;
}
