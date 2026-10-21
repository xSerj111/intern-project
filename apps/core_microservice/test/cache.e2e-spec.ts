/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import * as jwt from 'jsonwebtoken';
import type { Registry } from 'prom-client';
import { METRICS_REGISTRY } from '../src/common/observability/metrics.tokens';
import { bearer, metricValue } from './helpers/api.helpers';
import {
  PNG_BYTES,
  presignedUpload,
  uniqueBytes,
} from './helpers/attachment.helpers';
import { createE2eApp, type E2eApp } from './helpers/app.helpers';
import { cleanupE2eData } from './helpers/cleanup.helpers';
import { createPublishedPosts } from './helpers/data.helpers';
import type { Session } from './helpers/realtime.helpers';

jest.setTimeout(120000);

/**
 * Caching over the real cache Redis (US5): profile and follow-count
 * cache-aside, invalidation after writes, TTL on every key and the signed
 * attachment link. The outage case (SC-008) needs a different env, so it lives
 * in cache-outage.e2e-spec.ts.
 */
describe('Cache (e2e)', () => {
  let e2e: E2eApp;
  let http: E2eApp['http'];
  let registry: Registry;
  let redis: Redis;
  let secret: string;
  const userIds: string[] = [];
  const postIds: string[] = [];

  const newUser = async (): Promise<Session> => {
    const userId = randomUUID();
    userIds.push(userId);
    const session: Session = {
      email: `${userId}@test.local`,
      userId,
      accessToken: jwt.sign(
        { sub: userId, email: `${userId}@test.local`, jti: randomUUID() },
        secret,
        { algorithm: 'HS256', expiresIn: '30m' },
      ),
      refreshToken: '',
    };
    // Profiles are created lazily on first use.
    await http.get('/profiles/me').set(bearer(session)).expect(200);
    return session;
  };

  const summary = async (userId: string, viewer?: Session) => {
    const req = http.get(`/profiles/by-user/${userId}`);
    const res = await (viewer ? req.set(bearer(viewer)) : req).expect(200);
    return res.body;
  };

  const cacheCount = (
    resource: 'profile' | 'follow_counts' | 'signed_url',
    result: 'hit' | 'miss' | 'error',
  ) => metricValue(registry, 'cache_requests_total', { resource, result });

  beforeAll(async () => {
    redis = new Redis({
      host: process.env.CACHE_REDIS_HOST || 'localhost',
      port: Number(process.env.CACHE_REDIS_PORT) || 6380,
    });
    e2e = await createE2eApp();
    http = e2e.http;
    registry = e2e.app.get<Registry>(METRICS_REGISTRY);
    secret = (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET)!;
  });

  afterAll(async () => {
    try {
      if (userIds.length) {
        const keys = userIds.flatMap((id) => [
          `cache:v1:profile:${id}`,
          `cache:v1:counts:${id}`,
        ]);
        await redis.del(...keys);
      }
      if (postIds.length) {
        await e2e.db.query('DELETE FROM posts WHERE id = ANY($1::uuid[])', [
          postIds,
        ]);
      }
    } catch (err) {
      console.warn('cache e2e cleanup failed', err);
    }
    await cleanupE2eData(e2e.db, userIds);
    await e2e.close();
    redis.disconnect();
  });

  it('(a) the first profile read misses and the second hits', async () => {
    const user = await newUser();
    const miss0 = await cacheCount('profile', 'miss');
    const hit0 = await cacheCount('profile', 'hit');

    const first = await summary(user.userId);
    expect(await cacheCount('profile', 'miss')).toBe(miss0 + 1);
    expect(await cacheCount('profile', 'hit')).toBe(hit0);

    const second = await summary(user.userId);
    expect(await cacheCount('profile', 'miss')).toBe(miss0 + 1);
    expect(await cacheCount('profile', 'hit')).toBe(hit0 + 1);
    expect(second).toEqual(first);
  });

  it('(b) editing the profile makes the next read fresh', async () => {
    const user = await newUser();
    const before = await summary(user.userId);
    await summary(user.userId); // now cached
    const bio = `fresh bio ${randomUUID().slice(0, 8)}`;

    await http
      .patch(`/profiles/${before.id}`)
      .set(bearer(user))
      .send({ bio })
      .expect(200);

    const after = await summary(user.userId);
    expect(after.bio).toBe(bio);
    expect(before.bio).not.toBe(bio);
  });

  it('(c) follow and unfollow refresh both users counts', async () => {
    const [a, b] = [await newUser(), await newUser()];
    // Warm both counters.
    expect(await summary(a.userId)).toMatchObject({
      followerCount: 0,
      followingCount: 0,
    });
    expect(await summary(b.userId)).toMatchObject({
      followerCount: 0,
      followingCount: 0,
    });
    await summary(a.userId);
    await summary(b.userId);

    await http
      .post('/follows')
      .set(bearer(a))
      .send({ followingId: b.userId })
      .expect(201);
    expect(await summary(a.userId)).toMatchObject({
      followerCount: 0,
      followingCount: 1,
    });
    expect(await summary(b.userId)).toMatchObject({
      followerCount: 1,
      followingCount: 0,
    });
    // Warm again before the unfollow.
    await summary(a.userId);
    await summary(b.userId);

    await http.delete(`/follows/${b.userId}`).set(bearer(a)).expect(200);
    expect(await summary(a.userId)).toMatchObject({
      followerCount: 0,
      followingCount: 0,
    });
    expect(await summary(b.userId)).toMatchObject({
      followerCount: 0,
      followingCount: 0,
    });
  });

  it('(d) publishing a post refreshes the author postCount', async () => {
    const author = await newUser();
    expect((await summary(author.userId)).postCount).toBe(0);
    await summary(author.userId); // cached

    const created = await http
      .post('/posts')
      .set(bearer(author))
      .send({ content: `cache e2e ${randomUUID()}` })
      .expect(201);
    postIds.push(created.body.id);
    // A draft is not counted.
    expect((await summary(author.userId)).postCount).toBe(0);
    await http
      .post(`/posts/${created.body.id}/publish`)
      .set(bearer(author))
      .expect(201);
    expect((await summary(author.userId)).postCount).toBe(1);

    const more = await createPublishedPosts(http, author, 1);
    postIds.push(...more.map((p) => p.id));
    expect((await summary(author.userId)).postCount).toBe(2);
  });

  describe('signed attachment link', () => {
    let sender: Session;
    let peer: Session;
    let chatId: string;
    let assetId: string;
    const chatIds: string[] = [];

    const messageUrls = async (s: Session): Promise<string[]> => {
      const res = await http
        .get(`/chats/${chatId}/messages`)
        .set(bearer(s))
        .expect(200);
      return res.body.items.flatMap((m: any) =>
        m.attachments.map((x: any) => x.url as string),
      );
    };

    beforeAll(async () => {
      [sender, peer] = [await newUser(), await newUser()];
      const chat = await http
        .post('/chats/direct')
        .set(bearer(sender))
        .send({ userId: peer.userId })
        .expect(201);
      chatId = chat.body.id;
      chatIds.push(chatId);
      const tag = randomUUID();
      const upload = await presignedUpload(
        http,
        sender,
        'chat-attachment',
        uniqueBytes(PNG_BYTES, tag),
        'image/png',
        `${tag}.png`,
      );
      assetId = upload.id;
      await http
        .post(`/chats/${chatId}/messages`)
        .set(bearer(sender))
        .send({ clientMessageId: randomUUID(), attachmentIds: [assetId] })
        .expect(201);
    });

    afterAll(async () => {
      try {
        const keys = await redis.keys(`cache:v1:surl:${assetId}:*`);
        if (keys.length) await redis.del(...keys);
      } catch {
        /* keys expire on their own */
      }
    });

    it('(f) every returned link has at least 7.5 minutes left, cached or not', async () => {
      const hit0 = await cacheCount('signed_url', 'hit');
      const [first] = await messageUrls(peer);
      const [second] = await messageUrls(peer);
      expect(first).toBeDefined();
      // The second read is served from the cache: the very same link.
      expect(second).toBe(first);
      expect(await cacheCount('signed_url', 'hit')).toBeGreaterThan(hit0);

      for (const url of [first, second]) {
        const q = new URL(url).searchParams;
        const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(
          q.get('X-Amz-Date') ?? '',
        );
        expect(m).not.toBeNull();
        const signedAt = Date.UTC(
          +m![1],
          +m![2] - 1,
          +m![3],
          +m![4],
          +m![5],
          +m![6],
        );
        const expiresAt = signedAt + Number(q.get('X-Amz-Expires')) * 1000;
        expect(expiresAt - Date.now()).toBeGreaterThanOrEqual(450_000);
      }
    });

    it('(e) every cache:v1:* key the suite created has a TTL', async () => {
      const wanted = [
        ...userIds.flatMap((id) => [
          `cache:v1:profile:${id}`,
          `cache:v1:counts:${id}`,
        ]),
        ...(await redis.keys(`cache:v1:surl:${assetId}:*`)),
      ];
      const present: string[] = [];
      for (const key of wanted) {
        if ((await redis.exists(key)) === 1) present.push(key);
      }
      // Profiles, counts and the signed link were all read in this suite.
      expect(present.some((k) => k.startsWith('cache:v1:profile:'))).toBe(true);
      expect(present.some((k) => k.startsWith('cache:v1:counts:'))).toBe(true);
      expect(present.some((k) => k.startsWith('cache:v1:surl:'))).toBe(true);
      for (const key of present) {
        const ttl = await redis.ttl(key);
        expect({ key, ttl: ttl > 0 }).toEqual({ key, ttl: true });
        expect(ttl).toBeLessThanOrEqual(450);
      }
    });

    afterAll(async () => {
      try {
        await e2e.db.query(
          'DELETE FROM message_assets WHERE "messageId" IN (SELECT id FROM messages WHERE "chatId" = ANY($1::uuid[]))',
          [chatIds],
        );
        await e2e.db.query('DELETE FROM messages WHERE "chatId" = ANY($1)', [
          chatIds,
        ]);
      } catch {
        /* cleanupE2eData removes the rest */
      }
    });
  });
});
