/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest payloads are untyped JSON */
import { CHANGES_PAGE_SIZE_MAX, PAGE_SIZE_MAX } from '@repo/contracts';
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import type request from 'supertest';
import { bearer, dbQueryCount } from './helpers/api.helpers';
import { createE2eApp, type E2eApp } from './helpers/app.helpers';
import { cleanupE2eData } from './helpers/cleanup.helpers';
import { createPublishedPosts, setCreatedAt } from './helpers/data.helpers';
import type { Session } from './helpers/realtime.helpers';

jest.setTimeout(180000);

/**
 * Pagination over real Postgres (US3): the page-size rule on every core list
 * endpoint, the feed cursor (tie-break, concurrent inserts, deleted cursor) and
 * the offset pages of followers/following/comments with `hasMore`. The app runs
 * with `PERF_INSTRUMENTATION=true` so the query-count cases (FR-013) can read
 * `X-Db-Query-Count`.
 */
describe('Pagination (e2e)', () => {
  let e2e: E2eApp;
  let http: E2eApp['http'];
  let secret: string;
  const userIds: string[] = [];

  /**
   * A user with a locally minted access token (as profile-posts does), so the
   * suite does not need the auth service. Profiles are created lazily.
   */
  const newUser = async (): Promise<Session> => {
    const userId = randomUUID();
    userIds.push(userId);
    const accessToken = jwt.sign(
      { sub: userId, email: `${userId}@test.local`, jti: randomUUID() },
      secret,
      { algorithm: 'HS256', expiresIn: '30m' },
    );
    const session: Session = {
      email: `${userId}@test.local`,
      userId,
      accessToken,
      refreshToken: '',
    };
    await http.get('/profiles/me').set(bearer(session)).expect(200);
    return session;
  };
  const newUsers = (n: number) =>
    Promise.all(Array.from({ length: n }, () => newUser()));

  let viewer: Session;
  let peer: Session;
  let chatId: string;
  let postId: string;
  const postIds: string[] = [];

  const feed = (s: Session, query: Record<string, string | number> = {}) =>
    http.get('/posts/feed').query(query).set(bearer(s));

  /** Walks the feed to the end; returns every id and the page sizes seen. */
  const walkFeed = async (s: Session, limit: number, first?: string) => {
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor = first;
    let last: any;
    do {
      const res = await feed(s, cursor ? { limit, cursor } : { limit }).expect(
        200,
      );
      last = res.body;
      ids.push(...last.items.map((p: any) => p.id));
      sizes.push(last.items.length);
      cursor = last.nextCursor ?? undefined;
    } while (cursor);
    return { ids, sizes, last };
  };

  const publishedPosts = async (s: Session, n: number) => {
    const posts = await createPublishedPosts(http, s, n);
    postIds.push(...posts.map((p) => p.id));
    return posts.map((p) => p.id);
  };

  beforeAll(async () => {
    e2e = await createE2eApp({ PERF_INSTRUMENTATION: 'true' });
    http = e2e.http;
    secret = (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET)!;
    [viewer, peer] = await newUsers(2);
    const chat = await http
      .post('/chats/direct')
      .set(bearer(viewer))
      .send({ userId: peer.userId })
      .expect(201);
    chatId = chat.body.id;
    [postId] = await publishedPosts(viewer, 1);
  });

  afterAll(async () => {
    try {
      if (postIds.length) {
        await e2e.db.query(
          'DELETE FROM comments WHERE "postId" = ANY($1::uuid[])',
          [postIds],
        );
        await e2e.db.query('DELETE FROM posts WHERE id = ANY($1::uuid[])', [
          postIds,
        ]);
      }
    } catch (err) {
      console.warn('pagination e2e cleanup failed', err);
    }
    await cleanupE2eData(e2e.db, userIds);
    await e2e.close();
  });

  describe('page-size rule on every list endpoint (SC-007)', () => {
    interface Endpoint {
      name: string;
      path: () => string;
      query?: Record<string, string>;
      max: number;
      auth: boolean;
    }
    const endpoints: Endpoint[] = [
      {
        name: 'GET /posts/feed',
        path: () => '/posts/feed',
        max: PAGE_SIZE_MAX,
        auth: true,
      },
      {
        name: 'GET /posts/search',
        path: () => '/posts/search',
        query: { keyword: 'pagination' },
        max: PAGE_SIZE_MAX,
        auth: false,
      },
      {
        name: 'GET /posts/author/:userId',
        path: () => `/posts/author/${viewer.userId}`,
        max: PAGE_SIZE_MAX,
        auth: false,
      },
      {
        name: 'GET /comments/post/:postId',
        path: () => `/comments/post/${postId}`,
        max: PAGE_SIZE_MAX,
        auth: false,
      },
      {
        name: 'GET /follows/:userId/followers',
        path: () => `/follows/${viewer.userId}/followers`,
        max: PAGE_SIZE_MAX,
        auth: false,
      },
      {
        name: 'GET /follows/:userId/following',
        path: () => `/follows/${viewer.userId}/following`,
        max: PAGE_SIZE_MAX,
        auth: false,
      },
      {
        name: 'GET /profiles/search',
        path: () => '/profiles/search',
        query: { q: 'e2e' },
        max: PAGE_SIZE_MAX,
        auth: true,
      },
      {
        name: 'GET /chats',
        path: () => '/chats',
        max: PAGE_SIZE_MAX,
        auth: true,
      },
      {
        name: 'GET /chats/:chatId/messages',
        path: () => `/chats/${chatId}/messages`,
        max: PAGE_SIZE_MAX,
        auth: true,
      },
      {
        name: 'GET /chats/:chatId/messages/changes',
        path: () => `/chats/${chatId}/messages/changes`,
        query: { afterChangeSeq: '0' },
        max: CHANGES_PAGE_SIZE_MAX,
        auth: true,
      },
    ];

    const get = (e: Endpoint, limit: string | number) => {
      const req = http
        .get(e.path())
        .query({ ...(e.query ?? {}), limit: String(limit) });
      return e.auth ? req.set(bearer(viewer)) : req;
    };

    it.each(endpoints)('$name accepts limit=max', async (e) => {
      await get(e, e.max).expect(200);
      await get(e, 1).expect(200);
    });

    it.each(endpoints)(
      '$name rejects max+1, 0, -1, abc, 1.5 and 100000 with 400 (never clamps)',
      async (e) => {
        for (const bad of [e.max + 1, 0, -1, 'abc', 1.5, 100000]) {
          const res = await get(e, bad);
          expect({ bad, status: res.status }).toEqual({ bad, status: 400 });
          expect(JSON.stringify(res.body.message)).toMatch(/limit/);
        }
      },
    );
  });

  describe('feed cursor errors', () => {
    it('page=2 is rejected with a pointer to the cursor', async () => {
      const res = await feed(viewer, { page: 2 }).expect(400);
      expect(res.body.message).toContain('page is not supported; use cursor');
      await feed(viewer, { page: 1 }).expect(400);
    });

    it.each([
      'not-a-cursor',
      Buffer.from('{"v":2,"t":"x","id":"y"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          v: 1,
          t: '2026-01-01T00:00:00Z',
          id: '00000000-0000-0000-0000-000000000000',
        }),
      ).toString('base64url'),
    ])('malformed cursor %s is rejected', async (cursor) => {
      const res = await feed(viewer, { cursor }).expect(400);
      expect(res.body.message).toContain('cursor is invalid');
    });
  });

  describe('feed keyset walk', () => {
    it('returns every post once, newest first, and a null cursor at the end', async () => {
      const author = await newUser();
      const created = await publishedPosts(author, 7);
      const expected = [...created].reverse();

      const { ids, sizes, last } = await walkFeed(author, 3);
      expect(ids).toEqual(expected);
      expect(sizes).toEqual([3, 3, 1]);
      expect(last.nextCursor).toBeNull();

      // exact multiple of the limit: no trailing empty page needed
      const exact = await feed(author, { limit: 7 }).expect(200);
      expect(exact.body.items).toHaveLength(7);
      expect(exact.body.nextCursor).toBeNull();
    });

    it('posts inserted between page requests never duplicate or shift later pages', async () => {
      const author = await newUser();
      const existing = await publishedPosts(author, 12);
      const expected = [...existing].reverse();

      const page1 = await feed(author, { limit: 5 }).expect(200);
      const collected: string[] = page1.body.items.map((p: any) => p.id);
      let cursor: string | null = page1.body.nextCursor;
      expect(cursor).not.toBeNull();

      const inserted = await publishedPosts(author, 20);
      while (cursor) {
        const res = await feed(author, { limit: 5, cursor }).expect(200);
        collected.push(...res.body.items.map((p: any) => p.id));
        cursor = res.body.nextCursor;
      }

      expect(new Set(collected).size).toBe(collected.length);
      expect(collected).toEqual(expected);
      for (const id of inserted) expect(collected).not.toContain(id);

      // a fresh first page sees the new posts on top
      const fresh = await feed(author, { limit: 5 }).expect(200);
      expect(fresh.body.items[0].id).toBe(inserted[inserted.length - 1]);
    });

    it('posts sharing a createdAt are each returned once across a page boundary', async () => {
      const author = await newUser();
      const created = await publishedPosts(author, 7);
      const times = [
        '2026-01-01T00:00:00.300000Z',
        '2026-01-01T00:00:00.200000Z',
        '2026-01-01T00:00:00.200000Z',
        '2026-01-01T00:00:00.200000Z',
        '2026-01-01T00:00:00.200000Z',
        '2026-01-01T00:00:00.200000Z',
        '2026-01-01T00:00:00.100000Z',
      ];
      for (let i = 0; i < created.length; i++) {
        await setCreatedAt(e2e.db, 'posts', created[i], times[i]);
      }
      // (createdAt DESC, id DESC); uuid text order equals Postgres uuid order
      const expected = created
        .map((id, i) => ({ id, t: times[i] }))
        .sort((x, y) =>
          x.t === y.t ? (x.id < y.id ? 1 : -1) : x.t < y.t ? 1 : -1,
        )
        .map((x) => x.id);

      for (const limit of [2, 3, 4]) {
        const { ids } = await walkFeed(author, limit);
        expect(ids).toEqual(expected);
      }
    });

    it('a cursor whose post was deleted continues from that position', async () => {
      const author = await newUser();
      const created = await publishedPosts(author, 6);
      const newestFirst = [...created].reverse();

      const page1 = await feed(author, { limit: 2 }).expect(200);
      expect(page1.body.items.map((p: any) => p.id)).toEqual(
        newestFirst.slice(0, 2),
      );
      const cursor: string = page1.body.nextCursor;
      expect(cursor).toEqual(expect.any(String));

      // the cursor points at newestFirst[1]; soft-delete it, then hard-delete
      // the next one for good measure
      await http
        .delete(`/posts/${newestFirst[1]}`)
        .set(bearer(author))
        .expect(204);
      const page2 = await feed(author, { limit: 2, cursor }).expect(200);
      expect(page2.body.items.map((p: any) => p.id)).toEqual(
        newestFirst.slice(2, 4),
      );

      await e2e.db.query('DELETE FROM posts WHERE id = $1', [newestFirst[2]]);
      const page2b = await feed(author, { limit: 2, cursor }).expect(200);
      expect(page2b.body.items.map((p: any) => p.id)).toEqual(
        newestFirst.slice(3, 5),
      );

      const { ids } = await walkFeed(author, 2, cursor);
      expect(ids).toEqual(newestFirst.slice(3));
    });

    it('shows own and followed authors, not strangers', async () => {
      const reader = await newUser();
      const followed = await newUser();
      const stranger = await newUser();
      await http
        .post('/follows')
        .set(bearer(reader))
        .send({ followingId: followed.userId })
        .expect(201);
      const [own] = await publishedPosts(reader, 1);
      const [theirs] = await publishedPosts(followed, 1);
      const [other] = await publishedPosts(stranger, 1);

      const { ids } = await walkFeed(reader, 10);
      expect(ids).toEqual(expect.arrayContaining([own, theirs]));
      expect(ids).not.toContain(other);

      await http
        .delete(`/follows/${followed.userId}`)
        .set(bearer(reader))
        .expect(200);
      const after = await walkFeed(reader, 10);
      expect(after.ids).toEqual([own]);
    });
  });

  describe('follow lists (IOffsetPage)', () => {
    let target: Session;
    let f1: Session;
    let f2: Session;
    let f3: Session;

    beforeAll(async () => {
      [target, f1, f2, f3] = await newUsers(4);
      // sequential, so createdAt order is f1 < f2 < f3
      for (const f of [f1, f2, f3]) {
        await http
          .post('/follows')
          .set(bearer(f))
          .send({ followingId: target.userId })
          .expect(201);
      }
      // target follows f1 then f2; f3 follows f1 (viewer relationship)
      for (const f of [f1, f2]) {
        await http
          .post('/follows')
          .set(bearer(target))
          .send({ followingId: f.userId })
          .expect(201);
      }
      await http
        .post('/follows')
        .set(bearer(f3))
        .send({ followingId: f1.userId })
        .expect(201);
    });

    const followersOf = (q: Record<string, number>, viewerS?: Session) => {
      const req = http.get(`/follows/${target.userId}/followers`).query(q);
      return viewerS ? req.set(bearer(viewerS)) : req;
    };
    const followingOf = (q: Record<string, number>, viewerS?: Session) => {
      const req = http.get(`/follows/${target.userId}/following`).query(q);
      return viewerS ? req.set(bearer(viewerS)) : req;
    };

    it('followers: newest first, hasMore from limit+1, last page and past the end', async () => {
      const p1 = await followersOf({ page: 1, limit: 2 }).expect(200);
      expect(p1.body).toMatchObject({ page: 1, limit: 2, hasMore: true });
      expect(p1.body.items.map((i: any) => i.followerId)).toEqual([
        f3.userId,
        f2.userId,
      ]);
      for (const i of p1.body.items) {
        expect(i).toMatchObject({
          followingId: target.userId,
          isFollowedByMe: false,
        });
        expect(i.id).toEqual(expect.any(String));
        expect(Number.isNaN(Date.parse(i.createdAt))).toBe(false);
      }

      const p2 = await followersOf({ page: 2, limit: 2 }).expect(200);
      expect(p2.body).toMatchObject({ page: 2, limit: 2, hasMore: false });
      expect(p2.body.items.map((i: any) => i.followerId)).toEqual([f1.userId]);

      const p3 = await followersOf({ page: 3, limit: 2 }).expect(200);
      expect(p3.body).toMatchObject({ items: [], hasMore: false });

      const exact = await followersOf({ page: 1, limit: 3 }).expect(200);
      expect(exact.body.items).toHaveLength(3);
      expect(exact.body.hasMore).toBe(false);

      const def = await followersOf({}).expect(200);
      expect(def.body).toMatchObject({ page: 1, limit: 50, hasMore: false });
    });

    it('following: newest first with hasMore', async () => {
      const p1 = await followingOf({ page: 1, limit: 1 }).expect(200);
      expect(p1.body).toMatchObject({ page: 1, limit: 1, hasMore: true });
      expect(p1.body.items.map((i: any) => i.followingId)).toEqual([f2.userId]);
      const p2 = await followingOf({ page: 2, limit: 1 }).expect(200);
      expect(p2.body.hasMore).toBe(false);
      expect(p2.body.items.map((i: any) => i.followingId)).toEqual([f1.userId]);
    });

    it('isFollowedByMe is computed for the authenticated viewer and false for anonymous', async () => {
      const flags = (res: any, key: 'followerId' | 'followingId') =>
        Object.fromEntries(
          res.body.items.map((i: any) => [i[key], i.isFollowedByMe]),
        );

      // f3 follows only f1
      const asF3 = await followersOf({}, f3).expect(200);
      expect(flags(asF3, 'followerId')).toEqual({
        [f1.userId]: true,
        [f2.userId]: false,
        [f3.userId]: false,
      });
      const asF3Following = await followingOf({}, f3).expect(200);
      expect(flags(asF3Following, 'followingId')).toEqual({
        [f1.userId]: true,
        [f2.userId]: false,
      });

      // target follows f1 and f2, not f3
      const asTarget = await followersOf({}, target).expect(200);
      expect(flags(asTarget, 'followerId')).toEqual({
        [f1.userId]: true,
        [f2.userId]: true,
        [f3.userId]: false,
      });

      const anon = await followersOf({}).expect(200);
      expect(Object.values(flags(anon, 'followerId'))).toEqual([
        false,
        false,
        false,
      ]);
      const garbage = await followersOf({})
        .set({ Authorization: 'Bearer garbage' })
        .expect(200);
      expect(Object.values(flags(garbage, 'followerId'))).toEqual([
        false,
        false,
        false,
      ]);
    });

    it('a user with no followers gets an empty page', async () => {
      const res = await http.get(`/follows/${f3.userId}/followers`).expect(200);
      expect(res.body).toEqual({
        items: [],
        page: 1,
        limit: 50,
        hasMore: false,
      });
    });
  });

  describe('comments (IOffsetPage by roots)', () => {
    let author: Session;
    let post: string;
    const c: Record<string, string> = {};

    const comment = async (name: string, parentId?: string) => {
      const res = await http
        .post('/comments')
        .set(bearer(author))
        .send({ postId: post, content: `c-${name}`, parentId })
        .expect(201);
      c[name] = res.body.id;
    };
    const page = (q: Record<string, number>) =>
      http.get(`/comments/post/${post}`).query(q);
    const names = (res: any): string[] =>
      res.body.items.map((i: any) => i.content.slice(2));

    beforeAll(async () => {
      author = await newUser();
      [post] = await publishedPosts(author, 1);
      for (const r of ['r1', 'r2', 'r3', 'r4']) await comment(r);
      // r2 -> a -> b -> d  (depth 3); r1 -> y and r1 -> x -> z, x deleted with z
      await comment('a', c.r2);
      await comment('b', c.a);
      await comment('d', c.b);
      await comment('y', c.r1);
      await comment('x', c.r1);
      await comment('z', c.x);
      await http.delete(`/comments/${c.x}`).set(bearer(author)).expect(204);
    });

    it('pages by roots (newest first) and appends their whole reply threads', async () => {
      const p1 = await page({ page: 1, limit: 2 }).expect(200);
      expect(p1.body).toMatchObject({ page: 1, limit: 2, hasMore: true });
      expect(names(p1)).toEqual(['r4', 'r3']);

      const p2 = await page({ page: 2, limit: 2 }).expect(200);
      expect(p2.body).toMatchObject({ page: 2, limit: 2, hasMore: false });
      // roots newest first, then replies oldest first at any depth
      expect(names(p2)).toEqual(['r2', 'r1', 'a', 'b', 'd', 'y']);
      const byName = Object.fromEntries(
        p2.body.items.map((i: any) => [i.content.slice(2), i]),
      );
      expect(byName.r2.parentId ?? null).toBeNull();
      expect(byName.a.parentId).toBe(c.r2);
      expect(byName.b.parentId).toBe(c.a);
      expect(byName.d.parentId).toBe(c.b);
      expect(byName.y.parentId).toBe(c.r1);
    });

    it('excludes soft-deleted replies and their subtree', async () => {
      const all = await page({ limit: 50 }).expect(200);
      const got = names(all);
      expect(got).not.toContain('x');
      expect(got).not.toContain('z');
      expect(got.sort()).toEqual(
        ['r1', 'r2', 'r3', 'r4', 'a', 'b', 'd', 'y'].sort(),
      );
      expect(all.body).toMatchObject({ page: 1, limit: 50, hasMore: false });
    });

    it('hasMore counts roots, not replies', async () => {
      const exact = await page({ page: 1, limit: 4 }).expect(200);
      expect(exact.body.hasMore).toBe(false);
      expect(exact.body.items).toHaveLength(8);

      const three = await page({ page: 1, limit: 3 }).expect(200);
      expect(three.body.hasMore).toBe(true);
      expect(names(three)).toEqual(['r4', 'r3', 'r2', 'a', 'b', 'd']);

      const past = await page({ page: 3, limit: 2 }).expect(200);
      expect(past.body).toMatchObject({ items: [], hasMore: false });
    });

    it('a post without comments returns an empty page', async () => {
      const [other] = await publishedPosts(author, 1);
      const res = await http.get(`/comments/post/${other}`).expect(200);
      expect(res.body).toEqual({
        items: [],
        page: 1,
        limit: 20,
        hasMore: false,
      });
    });
  });

  describe('query count does not grow with the page size (FR-013)', () => {
    let author: Session;
    let target: Session;
    let countPost: string;

    beforeAll(async () => {
      [author, target] = await newUsers(2);
      const followers = await newUsers(7);
      const followed = await newUsers(7);
      await publishedPosts(author, 8);
      [countPost] = await publishedPosts(author, 1);
      // 7 roots, three of them with a reply
      const roots: string[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await http
          .post('/comments')
          .set(bearer(author))
          .send({ postId: countPost, content: `qc-root-${i}` })
          .expect(201);
        roots.push(res.body.id);
      }
      for (const parentId of roots.slice(0, 3)) {
        await http
          .post('/comments')
          .set(bearer(author))
          .send({ postId: countPost, content: 'qc-reply', parentId })
          .expect(201);
      }
      for (const f of followers) {
        await http
          .post('/follows')
          .set(bearer(f))
          .send({ followingId: target.userId })
          .expect(201);
      }
      for (const f of followed) {
        await http
          .post('/follows')
          .set(bearer(target))
          .send({ followingId: f.userId })
          .expect(201);
      }
    });

    const cases: Array<{
      name: string;
      get: (limit: number) => request.Test;
      items: number;
    }> = [
      {
        name: 'feed',
        get: (limit) => feed(author, { limit }),
        items: 9,
      },
      {
        name: 'root comments (with replies)',
        get: (limit) =>
          http
            .get(`/comments/post/${countPost}`)
            .query({ limit })
            .set(bearer(author)),
        items: 10,
      },
      {
        name: 'followers',
        get: (limit) =>
          http
            .get(`/follows/${target.userId}/followers`)
            .query({ limit })
            .set(bearer(author)),
        items: 7,
      },
      {
        name: 'following',
        get: (limit) =>
          http
            .get(`/follows/${target.userId}/following`)
            .query({ limit })
            .set(bearer(author)),
        items: 7,
      },
    ];

    it.each(cases)(
      '$name runs the same number of queries for limit=5 and limit=50',
      async ({ get, items }) => {
        const small = await get(5).expect(200);
        const large = await get(50).expect(200);
        // the larger page really returns more rows, yet costs the same
        expect(large.body.items.length).toBeGreaterThan(
          small.body.items.length,
        );
        expect(large.body.items).toHaveLength(items);
        expect(dbQueryCount(large)).toBe(dbQueryCount(small));
        expect(dbQueryCount(small)).toBeGreaterThan(0);
      },
    );
  });

  describe('create responses (no extra enrichment queries)', () => {
    it('POST /posts returns likeCount 0, commentCount 0 and likedByMe false', async () => {
      const user = await newUser();
      const res = await http
        .post('/posts')
        .set(bearer(user))
        .send({ content: 'fresh post' })
        .expect(201);
      postIds.push(res.body.id);
      expect(res.body).toMatchObject({
        content: 'fresh post',
        likeCount: 0,
        commentCount: 0,
        likedByMe: false,
      });
    });

    it('POST /comments carries the joined author', async () => {
      const user = await newUser();
      const [post] = await publishedPosts(user, 1);
      const res = await http
        .post('/comments')
        .set(bearer(user))
        .send({ postId: post, content: 'hello author' })
        .expect(201);
      expect(res.body).toMatchObject({
        authorId: user.userId,
        content: 'hello author',
        likeCount: 0,
        likedByMe: false,
        author: { userId: user.userId },
      });
      expect(res.body.author.username).toEqual(expect.any(String));
      expect(res.body.author.displayName).toEqual(expect.any(String));
    });
  });
});
