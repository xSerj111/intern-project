/* eslint-disable @typescript-eslint/no-unsafe-assignment -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { SelectQueryBuilder } from 'typeorm';
import { createE2eApp, type E2eApp } from './helpers/app.helpers';
import { uniqueSuffix } from './helpers/data.helpers';

jest.setTimeout(60000);

/**
 * People search against Postgres: infix match on username OR display name,
 * LIKE escaping, ranking and caller exclusion. Profiles are inserted directly
 * and tokens are minted locally, so the auth service is not involved. Every
 * username carries a per-run token `t`, so reruns don't collide.
 */
describe('GET /profiles/search', () => {
  let e2e: E2eApp;
  let secret: string;

  const t = `p${uniqueSuffix()}`;
  const caller = randomUUID();
  const other = randomUUID();
  const fixtures = {
    exact: { username: `${t}alice`, displayName: `Alice ${t}Smith` },
    prefix: { username: `${t}alicea`, displayName: 'Prefix Match' },
    infix: { username: `m${t}alice`, displayName: 'Bob' },
    displayOnly: { username: `zed${t}`, displayName: `Ma${t}alice Zed` },
    middle: { username: `pre${t}mid`, displayName: 'Middle' },
    abc: { username: `${t}abc`, displayName: 'Abc' },
  };
  const ids = Object.fromEntries(
    Object.keys(fixtures).map((k) => [k, randomUUID()]),
  ) as Record<keyof typeof fixtures, string>;
  const allIds = [caller, other, ...Object.values(ids)];

  const as = (sub: string) => ({
    Authorization: `Bearer ${jwt.sign(
      { sub, email: `${sub}@test.local`, jti: randomUUID() },
      secret,
      { algorithm: 'HS256', expiresIn: '10m' },
    )}`,
  });
  const search = async (q: string, sub = caller): Promise<string[]> => {
    const { body } = await e2e.http
      .get('/profiles/search')
      .query({ q })
      .set(as(sub))
      .expect(200);
    return (body as Array<{ username: string }>).map((u) => u.username);
  };

  beforeAll(async () => {
    e2e = await createE2eApp();
    secret = (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET)!;
    const rows: Array<[string, string, string]> = [
      [caller, `${t}me`, 'Caller'],
      [other, `${t}other`, 'Other'],
      ...Object.entries(fixtures).map(
        ([k, f]) =>
          [ids[k as keyof typeof fixtures], f.username, f.displayName] as [
            string,
            string,
            string,
          ],
      ),
    ];
    for (const [authUserId, username, displayName] of rows) {
      await e2e.db.query(
        'INSERT INTO user_profiles ("authUserId", username, "displayName") VALUES ($1, $2, $3)',
        [authUserId, username, displayName],
      );
    }
  });

  afterAll(async () => {
    try {
      await e2e.db.query(
        'DELETE FROM user_profiles WHERE "authUserId" = ANY($1::uuid[])',
        [allIds],
      );
    } catch (err) {
      console.warn('search-people e2e cleanup failed', err);
    }
    await e2e.close();
  });

  it('matches a query that appears only in a display name (case-insensitive)', async () => {
    expect(await search(`${t}SMITH`)).toEqual([fixtures.exact.username]);
  });

  it('matches a username infix that is not a prefix', async () => {
    expect(await search(`${t}mid`)).toEqual([fixtures.middle.username]);
  });

  it('ranks the exact username first, then prefix, then infix and display-name matches', async () => {
    const result = await search(`${t}alice`);

    expect(result.slice(0, 2)).toEqual([
      fixtures.exact.username,
      fixtures.prefix.username,
    ]);
    expect(result.slice(2).sort()).toEqual(
      [fixtures.infix.username, fixtures.displayOnly.username].sort(),
    );
  });

  it('escapes LIKE wildcards: q=a_ does not match abc, q=% matches nothing', async () => {
    expect(await search(`${t}abc`)).toEqual([fixtures.abc.username]);
    expect(await search(`${t}a_`)).toEqual([]);
    expect(await search(`${t}%`)).toEqual([]);
  });

  it('leaves the caller out of their own results', async () => {
    expect(await search(`${t}me`)).toEqual([]);
    expect(await search(`${t}me`, other)).toEqual([`${t}me`]);
  });

  it('rejects a query under 2 characters with 400', async () => {
    await e2e.http
      .get('/profiles/search')
      .query({ q: 'a' })
      .set(as(caller))
      .expect(400);
  });

  it('issues one query with a single plain LIMIT', async () => {
    const spy = jest.spyOn(SelectQueryBuilder.prototype, 'getMany');
    try {
      await search(`${t}alice`);
      const sql = spy.mock.contexts
        .map((qb) => (qb as SelectQueryBuilder<object>).getQuery())
        .find((q) => q.includes('"user_profiles"') && q.includes('similarity'));
      expect(sql).toBeDefined();
      expect(sql!.match(/\bLIMIT\b/g)).toHaveLength(1);
      expect(sql).not.toMatch(/SELECT DISTINCT/);
    } finally {
      spy.mockRestore();
    }
  });
});
