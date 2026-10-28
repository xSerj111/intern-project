/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainExceptionFilter } from '@repo/shared';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { AppModule } from './../src/app.module';
import { uniqueSuffix } from './helpers/data.helpers';

jest.setTimeout(60000);

interface SearchPage {
  items: Array<{
    id: string;
    content: string;
    likeCount: number;
    likedByMe: boolean;
  }>;
  total: number;
  page: number;
  limit: number;
}

/**
 * `GET /posts/search` against Postgres. Every fixture's content starts with a
 * per-run token and every keyword includes it, so reruns and the dev dataset
 * never change the counts. Tokens are minted locally with the server's JWT
 * secret, so the auth service does not need to run.
 */
describe('GET /posts/search', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let secret: string;

  const author = randomUUID();
  const viewer = randomUUID();
  const tok = `zq${uniqueSuffix()}`;
  const ids: Record<string, string> = {};

  const token = (sub: string) =>
    jwt.sign({ sub, email: `${sub}@test.local`, jti: randomUUID() }, secret, {
      algorithm: 'HS256',
      expiresIn: '10m',
    });
  const as = (sub: string) => ({ Authorization: `Bearer ${token(sub)}` });
  const createPost = async (content: string, publish = true) => {
    const { body } = await http
      .post('/posts')
      .set(as(author))
      .send({ content })
      .expect(201);
    if (publish) {
      await http.post(`/posts/${body.id}/publish`).set(as(author)).expect(201);
    }
    return body.id as string;
  };
  const search = async (
    query: Record<string, string | number>,
    sub?: string,
  ): Promise<SearchPage> => {
    const req = http.get('/posts/search').query(query);
    const res = await (sub ? req.set(as(sub)) : req).expect(200);
    return res.body as SearchPage;
  };
  const contents = (body: SearchPage): string[] =>
    body.items.map((p) => p.content);

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
    await http.get('/profiles/me').set(as(viewer)).expect(200);

    ids.percent = await createPost(`${tok} 100% done`);
    ids.plain = await createPost(`${tok} 100 done`);
    ids.abc = await createPost(`${tok}abc`);
    ids.underscore = await createPost(`${tok}a_c`);
    ids.draft = await createPost(`${tok} 100% draft`, false);
    ids.deleted = await createPost(`${tok} 100% deleted`);
    await http.delete(`/posts/${ids.deleted}`).set(as(author)).expect(204);
    for (const n of [1, 2, 3]) {
      ids[`page${n}`] = await createPost(`${tok} paged ${n}`);
    }
  });

  afterAll(async () => {
    try {
      await db.query('DELETE FROM posts WHERE "authorId" = $1', [author]);
      await db.query(
        'DELETE FROM user_profiles WHERE "authUserId" IN ($1, $2)',
        [author, viewer],
      );
    } catch (err) {
      console.warn('search-posts e2e cleanup failed', err);
    }
    await app.close();
  });

  it('treats % in the keyword literally', async () => {
    const body = await search({ keyword: `${tok} 100%` });
    expect(contents(body)).toEqual([`${tok} 100% done`]);
    expect(body.total).toBe(1);
  });

  it('treats _ in the keyword literally', async () => {
    const body = await search({ keyword: `${tok}a_c` });
    expect(contents(body)).toEqual([`${tok}a_c`]);
  });

  it('matches case-insensitively anywhere in the content', async () => {
    const body = await search({ keyword: `${tok.toUpperCase()} 100` });
    expect(contents(body).sort()).toEqual(
      [`${tok} 100 done`, `${tok} 100% done`].sort(),
    );
  });

  it('excludes drafts and soft-deleted posts', async () => {
    const body = await search({ keyword: `${tok} 100%` });
    const found = body.items.map((p) => p.id);
    expect(found).not.toContain(ids.draft);
    expect(found).not.toContain(ids.deleted);
  });

  it('works without a token and reports likedByMe false', async () => {
    await http.put(`/posts/${ids.percent}/like`).set(as(viewer)).expect(200);

    const body = await search({ keyword: `${tok} 100%` });
    expect(body.items[0]).toMatchObject({
      id: ids.percent,
      likeCount: 1,
      likedByMe: false,
    });
  });

  it('fills likedByMe for the viewer when a token is sent', async () => {
    const body = await search({ keyword: `${tok} 100` }, viewer);
    const byId = new Map(body.items.map((p) => [p.id, p.likedByMe]));
    expect(byId.get(ids.percent)).toBe(true);
    expect(byId.get(ids.plain)).toBe(false);
  });

  it('pages newest first with page and limit', async () => {
    const first = await search({ keyword: `${tok} paged`, page: 1, limit: 2 });
    expect(first).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(contents(first)).toEqual([`${tok} paged 3`, `${tok} paged 2`]);

    const second = await search({ keyword: `${tok} paged`, page: 2, limit: 2 });
    expect(second).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(contents(second)).toEqual([`${tok} paged 1`]);
  });

  it('runs with the literal status and the soft-delete filter of the partial index', async () => {
    const sqls: string[] = [];
    // Calls through; `mock.contexts` holds each builder the request used.
    const spy = jest.spyOn(SelectQueryBuilder.prototype, 'getManyAndCount');
    try {
      await search({ keyword: `${tok} 100%` });
      for (const qb of spy.mock.contexts) {
        sqls.push((qb as SelectQueryBuilder<object>).getQuery());
      }
    } finally {
      spy.mockRestore();
    }

    const sql = sqls.find((s) => s.includes('ILIKE'));
    expect(sql).toBeDefined();
    expect(sql).toContain(`"p"."status" = 'published'`);
    expect(sql).toContain(`"p"."deletedAt" IS NULL`);
    expect(sql).toContain(`ILIKE '%' || :q || '%' ESCAPE '\\'`);
    expect(sql).not.toContain(tok);
  });
});
