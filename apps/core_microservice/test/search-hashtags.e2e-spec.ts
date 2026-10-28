/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainExceptionFilter } from '@repo/shared';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';

jest.setTimeout(60000);

/**
 * Covers the `posts.hashtags` column against Postgres. Tokens are minted
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
});
