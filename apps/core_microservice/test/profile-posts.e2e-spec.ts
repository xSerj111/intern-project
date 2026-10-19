/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainExceptionFilter } from '@repo/shared';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';

jest.setTimeout(60000);

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Covers the SQL behind the profile-page endpoints against Postgres (and
 * SeaweedFS for the avatar upload). Tokens are minted locally with the
 * server's JWT secret, so the auth service does not need to run.
 */
describe('Profile page: author posts, summary, avatar (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let secret: string;

  const author = randomUUID();
  const viewer = randomUUID();
  const token = (sub: string) =>
    jwt.sign({ sub, email: `${sub}@test.local`, jti: randomUUID() }, secret, {
      algorithm: 'HS256',
      expiresIn: '10m',
    });
  const as = (sub: string) => ({ Authorization: `Bearer ${token(sub)}` });
  const rows = <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    db.query(sql, params);

  const publishedIds: string[] = [];
  let draftId: string;
  let assetId: string;

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
    secret = (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET)!;

    for (const id of [author, viewer]) {
      await http.get('/profiles/me').set(as(id)).expect(200);
    }
  });

  afterAll(async () => {
    try {
      await rows(
        'DELETE FROM comments WHERE "postId" IN (SELECT id FROM posts WHERE "authorId" = $1)',
        [author],
      );
      await rows('DELETE FROM posts WHERE "authorId" = $1', [author]);
      await rows(
        'DELETE FROM follows WHERE "followerId" = ANY($1::uuid[]) OR "followingId" = ANY($1::uuid[])',
        [[author, viewer]],
      );
      await rows('DELETE FROM assets WHERE "uploaderId" = ANY($1::uuid[])', [
        [author, viewer],
      ]);
      await rows(
        'DELETE FROM user_profiles WHERE "authUserId" = ANY($1::uuid[])',
        [[author, viewer]],
      );
    } catch (err) {
      console.warn('profile-posts e2e cleanup failed', err);
    }
    await app.close();
  });

  describe('avatar', () => {
    const upload = async (
      sub: string,
      buf: Buffer,
      name: string,
      type: string,
    ) =>
      (
        await http
          .post('/assets/upload')
          .set(as(sub))
          .attach('file', buf, { filename: name, contentType: type })
          .expect(201)
      ).body;
    let profileId: string;

    beforeAll(async () => {
      profileId = (await http.get('/profiles/me').set(as(author))).body.id;
      assetId = (await upload(author, PNG, 'a.png', 'image/png')).id;
    });

    it("sets the avatar from the caller's public image and renames", async () => {
      const res = await http
        .patch(`/profiles/${profileId}`)
        .set(as(author))
        .send({ displayName: '  Ada  ', bio: 'hi', avatarAssetId: assetId })
        .expect(200);
      expect(res.body.displayName).toBe('Ada');
      expect(res.body.bio).toBe('hi');
      expect(res.body.avatarUrl).toEqual(expect.any(String));
    });

    it('rejects an asset uploaded by someone else (403) and a non-image (400)', async () => {
      const otherAsset = (await upload(viewer, PNG, 'v.png', 'image/png')).id;
      await http
        .patch(`/profiles/${profileId}`)
        .set(as(author))
        .send({ avatarAssetId: otherAsset })
        .expect(403);
      const pdf = (
        await upload(
          author,
          Buffer.from('%PDF-1.4'),
          'x.pdf',
          'application/pdf',
        )
      ).id;
      await http
        .patch(`/profiles/${profileId}`)
        .set(as(author))
        .send({ avatarAssetId: pdf })
        .expect(400);
      await http
        .patch(`/profiles/${profileId}`)
        .set(as(author))
        .send({ avatarAssetId: randomUUID() })
        .expect(400);
    });

    it("forbids editing another user's profile", async () => {
      await http
        .patch(`/profiles/${profileId}`)
        .set(as(viewer))
        .send({ bio: 'hacked' })
        .expect(403);
    });

    it('clears bio and avatar with null (persisted as NULL)', async () => {
      const res = await http
        .patch(`/profiles/${profileId}`)
        .set(as(author))
        .send({ bio: null, avatarAssetId: null })
        .expect(200);
      expect(res.body.bio).toBeNull();
      expect(res.body.avatarUrl).toBeNull();
      const [row] = await rows(
        'SELECT bio, "avatarUrl" FROM user_profiles WHERE id = $1',
        [profileId],
      );
      expect(row).toEqual({ bio: null, avatarUrl: null });
      // restore an avatar for the embedding assertions below
      await http
        .patch(`/profiles/${profileId}`)
        .set(as(author))
        .send({ avatarAssetId: assetId })
        .expect(200);
    });
  });

  describe('posts by author', () => {
    beforeAll(async () => {
      for (let i = 0; i < 3; i++) {
        const { body } = await http
          .post('/posts')
          .set(as(author))
          .send({ content: `pub ${i}`, assetIds: i === 0 ? [assetId] : [] })
          .expect(201);
        await http
          .post(`/posts/${body.id}/publish`)
          .set(as(author))
          .expect(201);
        publishedIds.push(body.id);
        // ensure distinct createdAt for ordering
        await new Promise((r) => setTimeout(r, 15));
      }
      draftId = (
        await http
          .post('/posts')
          .set(as(author))
          .send({ content: 'draft' })
          .expect(201)
      ).body.id;

      // two comments (one reply) and one soft-deleted on the first post
      const c1 = (
        await http
          .post('/comments')
          .set(as(viewer))
          .send({ postId: publishedIds[0], content: 'one' })
          .expect(201)
      ).body;
      await http
        .post('/comments')
        .set(as(author))
        .send({ postId: publishedIds[0], content: 'reply', parentId: c1.id })
        .expect(201);
      const gone = (
        await http
          .post('/comments')
          .set(as(viewer))
          .send({ postId: publishedIds[0], content: 'gone' })
          .expect(201)
      ).body;
      await http.delete(`/comments/${gone.id}`).set(as(viewer)).expect(204);
    });

    it('lists published posts newest first for an anonymous caller, with author, assets and commentCount', async () => {
      const res = await http.get(`/posts/author/${author}`).expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, limit: 20 });
      expect(res.body.items.map((p: any) => p.content)).toEqual([
        'pub 2',
        'pub 1',
        'pub 0',
      ]);
      const first = res.body.items[2];
      expect(first.author).toMatchObject({
        userId: author,
        displayName: 'Ada',
      });
      expect(first.commentCount).toBe(2);
      expect(res.body.items[0].commentCount).toBe(0);
      expect(first.assets).toEqual([
        {
          assetId,
          displayOrder: 0,
          url: expect.any(String),
          mimeType: 'image/png',
        },
      ]);
      expect(first.likedByMe).toBe(false);
    });

    it('paginates', async () => {
      const res = await http
        .get(`/posts/author/${author}?page=2&limit=2`)
        .expect(200);
      expect(res.body.total).toBe(3);
      expect(res.body.items.map((p: any) => p.content)).toEqual(['pub 0']);
    });

    it('rejects an oversized limit and bad ids', async () => {
      await http.get(`/posts/author/${author}?limit=51`).expect(400);
      await http.get('/posts/author/not-a-uuid').expect(400);
    });

    it('lists drafts only for the author (403 otherwise, incl. anonymous)', async () => {
      const own = await http
        .get(`/posts/author/${author}?status=draft`)
        .set(as(author))
        .expect(200);
      expect(own.body.items.map((p: any) => p.id)).toEqual([draftId]);
      await http
        .get(`/posts/author/${author}?status=draft`)
        .set(as(viewer))
        .expect(403);
      await http.get(`/posts/author/${author}?status=archived`).expect(403);
    });

    it('does not shadow GET /posts/:id and fills author on create/publish', async () => {
      const res = await http.get(`/posts/${publishedIds[0]}`).expect(200);
      expect(res.body.commentCount).toBe(2);
      expect(res.body.author.userId).toBe(author);
      const created = await http
        .post('/posts')
        .set(as(author))
        .send({ content: 'fresh', assetIds: [assetId] })
        .expect(201);
      expect(created.body.author.userId).toBe(author);
      expect(created.body.assets[0].url).toEqual(expect.any(String));
      const updated = await http
        .patch(`/posts/${created.body.id}`)
        .set(as(author))
        .send({ content: 'fresh2' })
        .expect(200);
      expect(updated.body.assets[0].mimeType).toBe('image/png');
      expect(updated.body.author.userId).toBe(author);
    });

    it('embeds authors in comments and in the feed', async () => {
      const comments = await http
        .get(`/comments/post/${publishedIds[0]}`)
        .expect(200);
      expect(comments.body).toHaveLength(2);
      for (const c of comments.body) {
        expect(c.author.userId).toBe(c.authorId);
      }
      const feed = await http.get('/posts/feed').set(as(author)).expect(200);
      expect(feed.body.items[0].author.userId).toBe(author);
      expect(typeof feed.body.items[0].commentCount).toBe('number');
    });
  });

  describe('profile summary', () => {
    it('counts followers, following and published posts', async () => {
      await http
        .post('/follows')
        .set(as(viewer))
        .send({ followingId: author })
        .expect(201);

      const res = await http
        .get(`/profiles/by-user/${author}`)
        .set(as(viewer))
        .expect(200);
      expect(res.body).toMatchObject({
        authUserId: author,
        followerCount: 1,
        followingCount: 0,
        postCount: 3,
        isFollowedByMe: true,
      });

      const own = await http
        .get(`/profiles/by-user/${author}`)
        .set(as(author))
        .expect(200);
      expect(own.body.isFollowedByMe).toBe(false);

      const anon = await http.get(`/profiles/by-user/${viewer}`).expect(200);
      expect(anon.body).toMatchObject({
        followingCount: 1,
        isFollowedByMe: false,
      });
    });

    it('404s for an unknown user and keeps existing profile routes working', async () => {
      await http.get(`/profiles/by-user/${randomUUID()}`).expect(404);
      await http.get('/profiles/me').set(as(author)).expect(200);
      await http
        .get('/profiles/by-users')
        .query({ ids: author })
        .set(as(author))
        .expect(200);
    });
  });
});
