/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainExceptionFilter } from '@repo/shared';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { uniqueSuffix } from './helpers/data.helpers';

jest.setTimeout(60000);

interface HashtagResult {
  tag: string;
  postCount: number;
}

interface FeedPage {
  items: Array<{ id: string; content: string; likeCount: number }>;
  nextCursor: string | null;
}

/**
 * Covers the `posts.hashtags` column and the `/hashtags` routes against
 * Postgres. Every tag in the `/hashtags` block starts with a per-run token, so
 * reruns and the dev seed never change the counts. Tokens are minted
 * locally with the server's JWT secret, so the auth service does not need
 * to run.
 */
describe('Hashtag search (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let secret: string;

  const author = randomUUID();
  const token = (sub: string) =>
    jwt.sign({ sub, email: `${sub}@test.local`, jti: randomUUID() }, secret, {
      algorithm: 'HS256',
      expiresIn: '10m',
    });
  const as = (sub: string) => ({ Authorization: `Bearer ${token(sub)}` });
  const rows = <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    db.query(sql, params);
  const storedTags = async (postId: string): Promise<string[]> => {
    const [row] = await rows<{ hashtags: string[] }>(
      'SELECT hashtags FROM posts WHERE id = $1',
      [postId],
    );
    return row.hashtags;
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
    secret = (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET)!;

    await http.get('/profiles/me').set(as(author)).expect(200);
  });

  afterAll(async () => {
    try {
      await rows('DELETE FROM posts WHERE "authorId" = $1', [author]);
      await rows('DELETE FROM user_profiles WHERE "authUserId" = $1', [author]);
    } catch (err) {
      console.warn('search-hashtags e2e cleanup failed', err);
    }
    await app.close();
  });

  describe('hashtags column', () => {
    it('stores the normalized tags of a new post', async () => {
      const { body } = await http
        .post('/posts')
        .set(as(author))
        .send({ content: 'hello #One #two' })
        .expect(201);
      expect(await storedTags(body.id)).toEqual(['one', 'two']);
    });

    it('stores an empty array when the content has no tags', async () => {
      const { body } = await http
        .post('/posts')
        .set(as(author))
        .send({ content: 'no tags here' })
        .expect(201);
      expect(await storedTags(body.id)).toEqual([]);
    });

    it('lowercases and de-duplicates tags', async () => {
      const { body } = await http
        .post('/posts')
        .set(as(author))
        .send({ content: '#Tag #TAG #tag #other' })
        .expect(201);
      expect(await storedTags(body.id)).toEqual(['tag', 'other']);
    });

    it('replaces the tags when the content is edited', async () => {
      const { body } = await http
        .post('/posts')
        .set(as(author))
        .send({ content: '#One #two' })
        .expect(201);
      await http
        .patch(`/posts/${body.id}`)
        .set(as(author))
        .send({ content: 'now #three only' })
        .expect(200);
      expect(await storedTags(body.id)).toEqual(['three']);

      await http
        .patch(`/posts/${body.id}`)
        .set(as(author))
        .send({ content: 'plain text' })
        .expect(200);
      expect(await storedTags(body.id)).toEqual([]);
    });
  });

  describe('hashtags', () => {
    const tok = `h${uniqueSuffix()}`;
    const ids: Record<string, string> = {};

    const createPost = async (content: string, publish = true) => {
      const { body } = await http
        .post('/posts')
        .set(as(author))
        .send({ content })
        .expect(201);
      if (publish) {
        await http
          .post(`/posts/${body.id}/publish`)
          .set(as(author))
          .expect(201);
      }
      return body.id as string;
    };
    const search = async (
      query: Record<string, string | number>,
    ): Promise<HashtagResult[]> => {
      const res = await http.get('/hashtags/search').query(query).expect(200);
      return res.body as HashtagResult[];
    };
    const feed = async (
      tag: string,
      query: Record<string, string | number> = {},
    ): Promise<FeedPage> => {
      const res = await http
        .get(`/hashtags/${encodeURIComponent(tag)}/posts`)
        .query(query)
        .expect(200);
      return res.body as FeedPage;
    };

    beforeAll(async () => {
      ids.summer1 = await createPost(`first #${tok}Summer`);
      ids.summer2 = await createPost(`second #${tok}summer and #${tok}summit`);
      ids.summerDraft = await createPost(`draft #${tok}summer`, false);
      ids.summerDeleted = await createPost(`deleted #${tok}summer`);
      await http
        .delete(`/posts/${ids.summerDeleted}`)
        .set(as(author))
        .expect(204);
      ids.abc = await createPost(`#${tok}abc`);
      ids.underscore = await createPost(`#${tok}a_c`);
      for (const n of [1, 2, 3, 4, 5]) {
        ids[`page${n}`] = await createPost(`paged ${n} #${tok}page`);
      }
    });

    it('counts only published, non-deleted posts, most used first', async () => {
      expect(await search({ q: `${tok}sum` })).toEqual([
        { tag: `${tok}summer`, postCount: 2 },
        { tag: `${tok}summit`, postCount: 1 },
      ]);
    });

    it('normalizes the query (# prefix, case)', async () => {
      expect(await search({ q: `#${tok.toUpperCase()}SUM` })).toEqual([
        { tag: `${tok}summer`, postCount: 2 },
        { tag: `${tok}summit`, postCount: 1 },
      ]);
    });

    it('treats _ in the query literally', async () => {
      expect(await search({ q: `${tok}a_` })).toEqual([
        { tag: `${tok}a_c`, postCount: 1 },
      ]);
    });

    it('applies the limit', async () => {
      expect(await search({ q: `${tok}sum`, limit: 1 })).toEqual([
        { tag: `${tok}summer`, postCount: 2 },
      ]);
    });

    it('rejects an invalid query or limit with 400', async () => {
      for (const query of [
        { q: 'a-b' },
        { q: '' },
        { q: 'x'.repeat(51) },
        { q: tok, limit: 0 },
        { q: tok, limit: 51 },
      ]) {
        await http.get('/hashtags/search').query(query).expect(400);
      }
    });

    it('lists the published posts of a tag, newest first, without a token', async () => {
      const body = await feed(`${tok.toUpperCase()}SUMMER`);
      expect(body.items.map((p) => p.id)).toEqual([ids.summer2, ids.summer1]);
      expect(body.items[0].likeCount).toBe(0);
      expect(body.nextCursor).toBeNull();
    });

    it('accepts an encoded # in the tag', async () => {
      const body = await feed(`#${tok}summit`);
      expect(body.items.map((p) => p.id)).toEqual([ids.summer2]);
    });

    it('pages by keyset with no duplicates or gaps', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const body: FeedPage = await feed(
          `${tok}page`,
          cursor ? { limit: 2, cursor } : { limit: 2 },
        );
        expect(body.items.length).toBeLessThanOrEqual(2);
        seen.push(...body.items.map((p) => p.id));
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(cursor).toBeNull();
      expect(seen).toEqual([
        ids.page5,
        ids.page4,
        ids.page3,
        ids.page2,
        ids.page1,
      ]);
    });

    it('rejects a bad cursor, an out-of-range limit or an invalid tag with 400', async () => {
      const path = `/hashtags/${tok}page/posts`;
      await http.get(path).query({ cursor: 'not-a-cursor' }).expect(400);
      await http.get(path).query({ limit: 0 }).expect(400);
      await http.get(path).query({ limit: 51 }).expect(400);
      await http.get('/hashtags/bad-tag/posts').expect(400);
    });

    it('drops a post from the feed once an edit removes the tag', async () => {
      const id = await createPost(`#${tok}edit then removed`);
      expect((await feed(`${tok}edit`)).items.map((p) => p.id)).toEqual([id]);

      await http
        .patch(`/posts/${id}`)
        .set(as(author))
        .send({ content: 'no tag anymore' })
        .expect(200);

      expect((await feed(`${tok}edit`)).items).toEqual([]);
      expect(await search({ q: `${tok}edit` })).toEqual([]);
    });
  });
});
