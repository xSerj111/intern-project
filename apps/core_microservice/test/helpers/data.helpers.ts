import { randomUUID } from 'node:crypto';
import type request from 'supertest';
import type { DataSource } from 'typeorm';
import { bearer } from './api.helpers';
import type { Session } from './realtime.helpers';

/** Short collision-free token for emails, usernames and post content. */
export const uniqueSuffix = (): string =>
  `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`;

/**
 * Creates and publishes `n` posts as `session`, one after another (so creation
 * order matches the returned order). Content defaults to a unique string.
 */
export async function createPublishedPosts(
  http: ReturnType<typeof request>,
  session: Session,
  n: number,
  { content }: { content?: string } = {},
): Promise<Array<{ id: string; content: string }>> {
  const posts: Array<{ id: string; content: string }> = [];
  for (let i = 0; i < n; i++) {
    const text = content ?? `e2e post ${uniqueSuffix()}`;
    const created = await http
      .post('/posts')
      .set(bearer(session))
      .send({ content: text })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await http.post(`/posts/${id}/publish`).set(bearer(session)).expect(201);
    posts.push({ id, content: text });
  }
  return posts;
}

/**
 * Overwrites `createdAt` of one row by direct SQL, e.g. `2026-01-01T00:00:00.123456Z`
 * (microsecond precision) to build exact tie-breaker cases for keyset pagination.
 * `table` must be a plain identifier (it is interpolated into the statement).
 */
export async function setCreatedAt(
  db: DataSource,
  table: string,
  id: string,
  isoWithMicros: string,
): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
    throw new Error(`invalid table name: ${table}`);
  }
  await db.query(
    `UPDATE "${table}" SET "createdAt" = $1::timestamptz WHERE id = $2`,
    [isoWithMicros, id],
  );
}
