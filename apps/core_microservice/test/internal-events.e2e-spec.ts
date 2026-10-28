import { randomUUID } from 'node:crypto';
import { createE2eApp, type E2eApp } from './helpers/app.helpers';
import { internalTokenHeader } from './helpers/api.helpers';
import { uniqueSuffix } from './helpers/data.helpers';

jest.setTimeout(60000);

const PATH = '/internal/events/user-created';
const UNAUTHORIZED = { statusCode: 401, message: 'Unauthorized' };

describe('POST /internal/events/user-created (e2e)', () => {
  let e2e: E2eApp;
  const created: string[] = [];

  const event = () => {
    const authUserId = randomUUID();
    created.push(authUserId);
    const handle = `ie${uniqueSuffix()}`.slice(0, 30);
    return {
      authUserId,
      email: `${handle}@example.com`,
      handle,
      timestamp: new Date().toISOString(),
    };
  };

  const profileCount = async (authUserId: string): Promise<number> => {
    const rows: { count: string }[] = await e2e.db.query(
      'SELECT COUNT(*)::text AS count FROM user_profiles WHERE "authUserId" = $1',
      [authUserId],
    );
    return Number(rows[0].count);
  };

  beforeAll(async () => {
    e2e = await createE2eApp();
  });

  afterAll(async () => {
    if (created.length > 0) {
      await e2e.db.query(
        'DELETE FROM user_profiles WHERE "authUserId" = ANY($1::uuid[])',
        [created],
      );
    }
    await e2e.close();
  });

  it('rejects a missing token without creating a profile', async () => {
    const body = event();
    const res = await e2e.http.post(PATH).send(body).expect(401);

    expect(res.body).toEqual(UNAUTHORIZED);
    expect(await profileCount(body.authUserId)).toBe(0);
  });

  it('rejects a wrong token without creating a profile', async () => {
    const body = event();
    for (const wrong of ['x', 'x'.repeat(64)]) {
      const res = await e2e.http
        .post(PATH)
        .set('X-Internal-Token', wrong)
        .send(body)
        .expect(401);
      expect(res.body).toEqual(UNAUTHORIZED);
    }
    expect(await profileCount(body.authUserId)).toBe(0);
  });

  it('creates the profile with a valid token', async () => {
    const body = event();
    await e2e.http.post(PATH).set(internalTokenHeader()).send(body).expect(200);

    expect(await profileCount(body.authUserId)).toBe(1);
  });
});
