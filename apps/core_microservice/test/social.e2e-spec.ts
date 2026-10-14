/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainExceptionFilter } from '@repo/shared';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { OUTBOX_PORT } from './../src/common/messaging/outbox.port';
import type { IOutboxPort } from './../src/common/messaging/outbox.port';
import {
  type Session,
  logout,
  registerAndLogin,
  sleep,
} from './helpers/realtime.helpers';

jest.setTimeout(90000);

interface OutboxRow {
  id: string;
  routingKey: string;
  payload: Record<string, any>;
  publishedAt: Date | null;
  attempts: number;
  lastError: string | null;
}

describe('Social: likes, events, outbox (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let outbox: IOutboxPort;

  let a: Session; // author
  let b: Session; // actor
  const postIds: string[] = [];
  const commentIds: string[] = [];
  const followIds: string[] = [];
  const outboxIds = new Set<string>();

  const authed = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });
  const rows = <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    db.query(sql, params);

  /** Outbox rows by routing key and a payload field (never by pending state). */
  const outboxRows = async (
    routingKey: string,
    field: string,
    value: string,
  ): Promise<OutboxRow[]> => {
    const found = await rows<OutboxRow>(
      `SELECT * FROM outbox_events WHERE "routingKey" = $1 AND payload->>'${field}' = $2 ORDER BY "occurredAt"`,
      [routingKey, value],
    );
    found.forEach((r) => outboxIds.add(r.id));
    return found;
  };

  const createPublishedPost = async (
    s: Session,
    content = `social e2e ${randomUUID()}`,
  ): Promise<{ id: string; content: string }> => {
    const created = await http
      .post('/posts')
      .set(authed(s))
      .send({ content })
      .expect(201);
    const id: string = created.body.id;
    postIds.push(id);
    await http.post(`/posts/${id}/publish`).set(authed(s)).expect(201);
    return { id, content };
  };

  const createComment = async (
    s: Session,
    postId: string,
    content = 'nice one',
    parentId?: string,
  ): Promise<string> => {
    const res = await http
      .post('/comments')
      .set(authed(s))
      .send({ postId, content, parentId })
      .expect(201);
    commentIds.push(res.body.id);
    return res.body.id;
  };

  const pollUntil = async <T>(
    probe: () => Promise<T>,
    ok: (v: T) => boolean,
    timeoutMs = 10000,
  ): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    let last = await probe();
    while (!ok(last) && Date.now() < deadline) {
      await sleep(100);
      last = await probe();
    }
    return last;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.listen(0);
    http = request(app.getHttpServer());
    db = app.get(DataSource);
    outbox = app.get<IOutboxPort>(OUTBOX_PORT);

    [a, b] = await Promise.all([
      registerAndLogin('soc-a'),
      registerAndLogin('soc-b'),
    ]);
    // Profiles are created lazily on first use.
    for (const s of [a, b]) {
      await http.get('/profiles/me').set(authed(s)).expect(200);
    }
  });

  afterAll(async () => {
    // Best-effort cleanup; auth users and profiles stay (no helper yet).
    try {
      if (commentIds.length) {
        await rows('DELETE FROM comment_likes WHERE "commentId" = ANY($1)', [
          commentIds,
        ]);
      }
      if (postIds.length) {
        await rows('DELETE FROM post_likes WHERE "postId" = ANY($1)', [
          postIds,
        ]);
      }
      if (commentIds.length) {
        await rows('DELETE FROM comments WHERE id = ANY($1)', [commentIds]);
      }
      if (followIds.length) {
        await rows('DELETE FROM follows WHERE id = ANY($1)', [followIds]);
      }
      if (postIds.length) {
        await rows('DELETE FROM posts WHERE id = ANY($1)', [postIds]);
      }
      if (outboxIds.size) {
        await rows('DELETE FROM outbox_events WHERE id = ANY($1)', [
          [...outboxIds],
        ]);
      }
    } catch (err) {
      console.warn('social e2e cleanup failed', err);
    }
    await Promise.all([a, b].filter(Boolean).map((s) => logout(s)));
    await app.close();
  });

  describe('post likes', () => {
    let postId: string;

    beforeAll(async () => {
      postId = (await createPublishedPost(a)).id;
    });

    const likedRows = () => outboxRows('social.post.liked', 'postId', postId);

    it('B likes: count 1 and exactly one social.post.liked row', async () => {
      const res = await http
        .put(`/posts/${postId}/like`)
        .set(authed(b))
        .expect(200);
      expect(res.body).toEqual({ liked: true, likeCount: 1 });

      const events = await likedRows();
      expect(events).toHaveLength(1);
      expect(events[0].payload.recipientId).toBe(a.userId);
      expect(events[0].payload.actor.userId).toBe(b.userId);
      expect(events[0].payload.postId).toBe(postId);
    });

    it('B likes again: no-op, still one row, count 1', async () => {
      const res = await http
        .put(`/posts/${postId}/like`)
        .set(authed(b))
        .expect(200);
      expect(res.body).toEqual({ liked: true, likeCount: 1 });
      expect(await likedRows()).toHaveLength(1);
    });

    it('B unlikes: count 0 and deletedAt set', async () => {
      const res = await http
        .delete(`/posts/${postId}/like`)
        .set(authed(b))
        .expect(200);
      expect(res.body).toEqual({ liked: false, likeCount: 0 });

      const like = await rows(
        'SELECT "deletedAt" FROM post_likes WHERE "postId" = $1 AND "userId" = $2',
        [postId, b.userId],
      );
      expect(like).toHaveLength(1);
      expect(like[0].deletedAt).not.toBeNull();

      // unliking again is an idempotent no-op
      const again = await http
        .delete(`/posts/${postId}/like`)
        .set(authed(b))
        .expect(200);
      expect(again.body).toEqual({ liked: false, likeCount: 0 });
    });

    it('B re-likes (restore): count 1, still exactly one row, no new event', async () => {
      const res = await http
        .put(`/posts/${postId}/like`)
        .set(authed(b))
        .expect(200);
      expect(res.body).toEqual({ liked: true, likeCount: 1 });

      const like = await rows(
        'SELECT "deletedAt" FROM post_likes WHERE "postId" = $1 AND "userId" = $2',
        [postId, b.userId],
      );
      expect(like).toHaveLength(1);
      expect(like[0].deletedAt).toBeNull();
      expect(await likedRows()).toHaveLength(1);
    });

    it('A likes own post: count 2, no new event (self-like)', async () => {
      const res = await http
        .put(`/posts/${postId}/like`)
        .set(authed(a))
        .expect(200);
      expect(res.body).toEqual({ liked: true, likeCount: 2 });
      expect(await likedRows()).toHaveLength(1);
    });

    it('rejects unauthenticated and unknown posts', async () => {
      await http.put(`/posts/${postId}/like`).expect(401);
      await http.put(`/posts/${randomUUID()}/like`).set(authed(b)).expect(404);
    });
  });

  describe('comment likes', () => {
    let postId: string;
    let commentId: string;

    beforeAll(async () => {
      postId = (await createPublishedPost(a)).id;
      // A's own comment on A's post, so B's like is the only comment-liked event source
      commentId = await createComment(a, postId, 'comment to like');
    });

    const likedRows = () =>
      outboxRows('social.comment.liked', 'commentId', commentId);

    it('B likes: count 1 and exactly one social.comment.liked row', async () => {
      const res = await http
        .put(`/comments/${commentId}/like`)
        .set(authed(b))
        .expect(200);
      expect(res.body).toEqual({ liked: true, likeCount: 1 });

      const events = await likedRows();
      expect(events).toHaveLength(1);
      expect(events[0].payload.recipientId).toBe(a.userId);
      expect(events[0].payload.postId).toBe(postId);
      expect(events[0].payload.actor.userId).toBe(b.userId);
    });

    it('B likes again: no-op', async () => {
      const res = await http
        .put(`/comments/${commentId}/like`)
        .set(authed(b))
        .expect(200);
      expect(res.body).toEqual({ liked: true, likeCount: 1 });
      expect(await likedRows()).toHaveLength(1);
    });

    it('B unlikes: count 0 and deletedAt set', async () => {
      const res = await http
        .delete(`/comments/${commentId}/like`)
        .set(authed(b))
        .expect(200);
      expect(res.body).toEqual({ liked: false, likeCount: 0 });

      const like = await rows(
        'SELECT "deletedAt" FROM comment_likes WHERE "commentId" = $1 AND "userId" = $2',
        [commentId, b.userId],
      );
      expect(like).toHaveLength(1);
      expect(like[0].deletedAt).not.toBeNull();
    });

    it('B re-likes (restore): count 1, no new event', async () => {
      const res = await http
        .put(`/comments/${commentId}/like`)
        .set(authed(b))
        .expect(200);
      expect(res.body).toEqual({ liked: true, likeCount: 1 });
      expect(await likedRows()).toHaveLength(1);
    });

    it('A likes own comment: count 2, no new event', async () => {
      const res = await http
        .put(`/comments/${commentId}/like`)
        .set(authed(a))
        .expect(200);
      expect(res.body).toEqual({ liked: true, likeCount: 2 });
      expect(await likedRows()).toHaveLength(1);
    });

    it('liking a soft-deleted comment returns 404', async () => {
      const doomed = await createComment(a, postId, 'to be deleted');
      await http.delete(`/comments/${doomed}`).set(authed(a)).expect(204);
      await http.put(`/comments/${doomed}/like`).set(authed(b)).expect(404);
      expect(
        await outboxRows('social.comment.liked', 'commentId', doomed),
      ).toHaveLength(0);
    });
  });

  describe('like stats and optional auth', () => {
    let post: { id: string; content: string };
    let commentId: string;

    beforeAll(async () => {
      post = await createPublishedPost(a);
      commentId = await createComment(a, post.id, 'stats comment');
      await http.put(`/posts/${post.id}/like`).set(authed(b)).expect(200);
      await http.put(`/posts/${post.id}/like`).set(authed(a)).expect(200);
      await http.put(`/comments/${commentId}/like`).set(authed(b)).expect(200);
    });

    const searchFor = (headers: Record<string, string> = {}) =>
      http
        .get('/posts/search')
        .query({ keyword: post.content })
        .set(headers)
        .expect(200);

    it('GET /posts/:id', async () => {
      const anon = await http.get(`/posts/${post.id}`).expect(200);
      expect(anon.body).toMatchObject({ likeCount: 2, likedByMe: false });

      const asB = await http
        .get(`/posts/${post.id}`)
        .set(authed(b))
        .expect(200);
      expect(asB.body).toMatchObject({ likeCount: 2, likedByMe: true });

      const garbage = await http
        .get(`/posts/${post.id}`)
        .set({ Authorization: 'Bearer not.a.token' })
        .expect(200);
      expect(garbage.body).toMatchObject({ likeCount: 2, likedByMe: false });
    });

    it('GET /posts/search', async () => {
      const anon = await searchFor();
      expect(anon.body.items).toHaveLength(1);
      expect(anon.body.items[0]).toMatchObject({
        id: post.id,
        likeCount: 2,
        likedByMe: false,
      });

      const asB = await searchFor(authed(b));
      expect(asB.body.items[0]).toMatchObject({
        likeCount: 2,
        likedByMe: true,
      });

      const garbage = await searchFor({ Authorization: 'Bearer garbage' });
      expect(garbage.body.items[0]).toMatchObject({
        likeCount: 2,
        likedByMe: false,
      });
    });

    it('GET /comments/post/:postId', async () => {
      const find = (res: request.Response) =>
        res.body.find((c: any) => c.id === commentId);

      const anon = await http.get(`/comments/post/${post.id}`).expect(200);
      expect(find(anon)).toMatchObject({ likeCount: 1, likedByMe: false });

      const asB = await http
        .get(`/comments/post/${post.id}`)
        .set(authed(b))
        .expect(200);
      expect(find(asB)).toMatchObject({ likeCount: 1, likedByMe: true });

      const asA = await http
        .get(`/comments/post/${post.id}`)
        .set(authed(a))
        .expect(200);
      expect(find(asA)).toMatchObject({ likeCount: 1, likedByMe: false });

      const garbage = await http
        .get(`/comments/post/${post.id}`)
        .set({ Authorization: 'Bearer garbage' })
        .expect(200);
      expect(find(garbage)).toMatchObject({ likeCount: 1, likedByMe: false });
    });

    it('a post nobody liked reports 0 / false', async () => {
      const fresh = await createPublishedPost(a);
      const res = await http
        .get(`/posts/${fresh.id}`)
        .set(authed(b))
        .expect(200);
      expect(res.body).toMatchObject({ likeCount: 0, likedByMe: false });
    });
  });

  describe('events from comments and follows', () => {
    let postId: string;

    beforeAll(async () => {
      postId = (await createPublishedPost(a)).id;
    });

    it('B comments on A post: one social.post.commented row, committed with the comment', async () => {
      const commentId = await createComment(b, postId, 'hello from B');

      const comment = await rows('SELECT id FROM comments WHERE id = $1', [
        commentId,
      ]);
      expect(comment).toHaveLength(1);
      const events = await outboxRows(
        'social.post.commented',
        'commentId',
        commentId,
      );
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        recipientId: a.userId,
        postId,
        commentId,
      });
      expect(events[0].payload.actor.userId).toBe(b.userId);
    });

    it('A comments on own post: no event', async () => {
      const commentId = await createComment(a, postId, 'self comment');
      expect(
        await outboxRows('social.post.commented', 'commentId', commentId),
      ).toHaveLength(0);
    });

    it('a reply by B does not notify the post author', async () => {
      const parent = await createComment(a, postId, 'parent');
      const reply = await createComment(b, postId, 'reply', parent);
      expect(
        await outboxRows('social.post.commented', 'commentId', reply),
      ).toHaveLength(0);
    });

    it('B follows A: one social.user.followed row; repeat follow adds none', async () => {
      const first = await http
        .post('/follows')
        .set(authed(b))
        .send({ followingId: a.userId })
        .expect(201);
      followIds.push(first.body.id);

      const follow = await rows('SELECT id FROM follows WHERE id = $1', [
        first.body.id,
      ]);
      expect(follow).toHaveLength(1);

      const byActor = async () =>
        (
          await outboxRows('social.user.followed', 'recipientId', a.userId)
        ).filter((r) => r.payload.actor.userId === b.userId);
      expect(await byActor()).toHaveLength(1);

      const again = await http
        .post('/follows')
        .set(authed(b))
        .send({ followingId: a.userId })
        .expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(await byActor()).toHaveLength(1);
      expect(
        await rows(
          'SELECT id FROM follows WHERE "followerId" = $1 AND "followingId" = $2',
          [b.userId, a.userId],
        ),
      ).toHaveLength(1);
    });
  });

  describe('outbox relay and adapter', () => {
    it('relay publishes the rows created above (publishedAt, attempts >= 1, no error)', async () => {
      const tracked = await rows<OutboxRow>(
        `SELECT * FROM outbox_events WHERE "routingKey" LIKE 'social.%' AND (
           payload->>'postId' = ANY($1) OR payload->>'commentId' = ANY($2)
           OR payload->>'recipientId' = $3)`,
        [postIds, commentIds, a.userId],
      );
      tracked.forEach((r) => outboxIds.add(r.id));
      expect(tracked.length).toBeGreaterThanOrEqual(5);
      const keys = new Set(tracked.map((r) => r.routingKey));
      expect(keys).toEqual(
        new Set([
          'social.post.liked',
          'social.comment.liked',
          'social.post.commented',
          'social.user.followed',
        ]),
      );

      const ids = tracked.map((r) => r.id);
      const done = await pollUntil(
        () =>
          rows<OutboxRow>('SELECT * FROM outbox_events WHERE id = ANY($1)', [
            ids,
          ]),
        (rs) => rs.every((r) => r.publishedAt !== null),
      );
      for (const r of done) {
        expect(r.publishedAt).not.toBeNull();
        expect(r.attempts).toBeGreaterThanOrEqual(1);
        expect(r.lastError).toBeNull();
      }
    });

    it('claimPending / markFailed / markPublished against Postgres', async () => {
      const marker = randomUUID();
      let id!: string;
      await db.transaction(async (tx) => {
        const added = await outbox.add('social.test.adapter', { marker }, tx);
        id = added.id;
        outboxIds.add(id);

        const claimed = await outbox.claimPending(100, tx);
        expect(claimed.map((r) => r.id)).toContain(id);

        await outbox.markFailed(id, 'boom', tx);
        const failed = await tx.query(
          'SELECT attempts, "lastError", "publishedAt" FROM outbox_events WHERE id = $1',
          [id],
        );
        expect(failed[0]).toMatchObject({
          attempts: 1,
          lastError: 'boom',
          publishedAt: null,
        });

        await outbox.markPublished(id, tx);
        const published = await tx.query(
          'SELECT attempts, "lastError", "publishedAt" FROM outbox_events WHERE id = $1',
          [id],
        );
        expect(published[0].attempts).toBe(2);
        expect(published[0].lastError).toBeNull();
        expect(published[0].publishedAt).not.toBeNull();
      });

      const final = await rows('SELECT * FROM outbox_events WHERE id = $1', [
        id,
      ]);
      expect(final).toHaveLength(1);
      expect(final[0].publishedAt).not.toBeNull();
    });

    it('an outbox row rolls back with its transaction', async () => {
      const marker = randomUUID();
      await expect(
        db.transaction(async (tx) => {
          await outbox.add('social.test.rollback', { marker }, tx);
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      const left = await rows(
        `SELECT id FROM outbox_events WHERE payload->>'marker' = $1`,
        [marker],
      );
      expect(left).toHaveLength(0);
    });
  });
});
