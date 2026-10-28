/**
 * Dev seed for `innogram_core`: profiles, follows, posts, comments and likes
 * from `seed/fixtures.ts`. Writes straight to the tables, so no outbox events
 * (and therefore no notifications) are produced.
 *
 *   npm run db:seed              # insert missing seed rows
 *   npm run db:seed -- --reset   # delete everything owned by seed users first
 *   npm run db:seed -- --profile perf [--reset]   # perf data instead (perf-profile.ts)
 */
import * as dotenv from 'dotenv';
import { join } from 'path';
import { Client } from 'pg';
import { corePostgresConnection } from '../src/database/database.config';
import { extractHashtags } from '../src/modules/posts/domain/hashtags';
import {
  commentId,
  commentLikes,
  comments,
  follows,
  postId,
  postLikes,
  posts,
  userId,
  users,
} from '../../../seed/fixtures';
import { isPerfProfile } from '../../../seed/perf';
import { seedPerfProfile } from './perf-profile';

dotenv.config({ path: join(__dirname, '../../../.env') });

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

/**
 * Hashtags appended to fixture posts (the shared fixtures stay tag-free).
 * `#innogram` is on 5 published posts plus a draft and an archived one, which
 * search must not return. `#café` is non-ASCII and `#2024` is digits only.
 */
const postTags: Record<string, string> = {
  p1: '#innogram #art',
  p2: '#art #jazz #travel',
  p4: '#innogram',
  p5: '#sourdough #2024',
  p7: '#innogram #dev',
  p10: '#innogram #running',
  p11: '#running #2024',
  p13: '#travel #photography #café',
  p16: '#travel #lisbon #innogram',
  p17: '#travel #café #lisbon',
  p19: '#innogram #dev',
};

async function main() {
  const reset = process.argv.includes('--reset');
  const conn = corePostgresConnection();
  const client = new Client({
    host: conn.host,
    port: conn.port,
    user: conn.username,
    password: conn.password,
    database: conn.database,
  });
  await client.connect();

  const counts: Record<string, number> = {};
  const run = async (table: string, sql: string, params: unknown[]) => {
    const res = await client.query(sql, params);
    counts[table] = (counts[table] ?? 0) + (res.rowCount ?? 0);
  };

  try {
    if (isPerfProfile()) return await seedPerfProfile(client, reset);

    await client.query('BEGIN');

    if (reset) {
      const ids = users.map((u) => u.id);
      // Comments/posts by seed users cascade to their likes and replies.
      await client.query(
        'DELETE FROM comment_likes WHERE "userId" = ANY($1::uuid[])',
        [ids],
      );
      await client.query(
        'DELETE FROM post_likes WHERE "userId" = ANY($1::uuid[])',
        [ids],
      );
      await client.query(
        'DELETE FROM comments WHERE "authorId" = ANY($1::uuid[])',
        [ids],
      );
      await client.query(
        'DELETE FROM posts WHERE "authorId" = ANY($1::uuid[])',
        [ids],
      );
      await client.query(
        'DELETE FROM follows WHERE "followerId" = ANY($1::uuid[]) OR "followingId" = ANY($1::uuid[])',
        [ids],
      );
      await client.query(
        'DELETE FROM user_profiles WHERE "authUserId" = ANY($1::uuid[])',
        [ids],
      );
    }

    for (const u of users) {
      await run(
        'user_profiles',
        `INSERT INTO user_profiles ("authUserId", username, "displayName", bio, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT DO NOTHING`,
        [u.id, u.handle, u.displayName, u.bio, hoursAgo(400)],
      );
    }

    for (const [follower, following] of follows) {
      await run(
        'follows',
        `INSERT INTO follows ("followerId", "followingId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $3)
         ON CONFLICT DO NOTHING`,
        [userId(follower), userId(following), hoursAgo(350)],
      );
    }

    for (const p of posts) {
      const content = postTags[p.key]
        ? `${p.content} ${postTags[p.key]}`
        : p.content;
      // Upsert content and hashtags so already-seeded rows pick the tags up.
      await run(
        'posts',
        `INSERT INTO posts (id, "authorId", content, hashtags, status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (id) DO UPDATE
           SET content = EXCLUDED.content, hashtags = EXCLUDED.hashtags`,
        [
          postId(p.key),
          userId(p.author),
          content,
          extractHashtags(content),
          p.status,
          hoursAgo(p.hoursAgo),
        ],
      );
    }

    // Fixtures list parents before replies, so FK order is satisfied.
    for (const c of comments) {
      await run(
        'comments',
        `INSERT INTO comments (id, "postId", "authorId", "parentId", content, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT DO NOTHING`,
        [
          commentId(c.key),
          postId(c.post),
          userId(c.author),
          c.parent ? commentId(c.parent) : null,
          c.content,
          hoursAgo(c.hoursAgo),
        ],
      );
    }

    for (const [post, likers] of postLikes) {
      for (const liker of likers) {
        await run(
          'post_likes',
          `INSERT INTO post_likes ("postId", "userId") VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [postId(post), userId(liker)],
        );
      }
    }

    for (const [comment, likers] of commentLikes) {
      for (const liker of likers) {
        await run(
          'comment_likes',
          `INSERT INTO comment_likes ("commentId", "userId") VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [commentId(comment), userId(liker)],
        );
      }
    }

    await client.query('COMMIT');
    console.log('core seed: rows inserted', counts);
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
