/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { bearer } from './helpers/api.helpers';
import { PNG_BYTES, uniqueBytes } from './helpers/attachment.helpers';
import { createE2eApp, type E2eApp } from './helpers/app.helpers';
import { cleanupE2eData } from './helpers/cleanup.helpers';
import type { Session } from './helpers/realtime.helpers';

jest.setTimeout(120000);

const ROUNDS = 20;
const SLOWEST_MS = 300;

/**
 * Privileged port nothing listens on. An ephemeral "free" port could be
 * re-bound by another worker's HTTP server while this suite runs.
 */
const CLOSED_PORT = '1';

/**
 * Cache Redis down (SC-008): the app is built with `CACHE_REDIS_PORT` on a
 * closed port, so every cache command fails. Profile, chat-list and message
 * reads must still answer 2xx, and none may be slowed by the cache. Own file
 * because createE2eApp applies one env set per Jest worker.
 */
describe('Cache outage (e2e)', () => {
  let e2e: E2eApp;
  let http: E2eApp['http'];
  let a: Session;
  let b: Session;
  const userIds: string[] = [];

  const newUser = async (secret: string): Promise<Session> => {
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
    await http.get('/profiles/me').set(bearer(session)).expect(200);
    return session;
  };

  beforeAll(async () => {
    e2e = await createE2eApp({
      CACHE_REDIS_HOST: '127.0.0.1',
      CACHE_REDIS_PORT: CLOSED_PORT,
    });
    http = e2e.http;
    const secret = (process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET)!;
    [a, b] = [await newUser(secret), await newUser(secret)];
  });

  afterAll(async () => {
    await cleanupE2eData(e2e.db, userIds);
    await e2e.close();
  });

  it('answers 20/20 profile, chat-list and message requests with 2xx, none slowed', async () => {
    const chat = await http
      .post('/chats/direct')
      .set(bearer(a))
      .send({ userId: b.userId })
      .expect(201);
    const chatId: string = chat.body.id;
    const tag = randomUUID();
    const upload = await http
      .post('/chats/attachments')
      .set(bearer(a))
      .attach('file', uniqueBytes(PNG_BYTES, tag), {
        filename: `${tag}.png`,
        contentType: 'image/png',
      })
      .expect(201);
    // Text and attachment messages, so the signed-URL cache is exercised too.
    await http
      .post(`/chats/${chatId}/messages`)
      .set(bearer(a))
      .send({ clientMessageId: randomUUID(), content: 'cache outage' })
      .expect(201);
    await http
      .post(`/chats/${chatId}/messages`)
      .set(bearer(a))
      .send({
        clientMessageId: randomUUID(),
        attachmentIds: [upload.body.id],
      })
      .expect(201);

    const calls: Array<[string, () => ReturnType<typeof http.get>]> = [
      ['profile', () => http.get(`/profiles/by-user/${a.userId}`)],
      ['chat list', () => http.get('/chats').set(bearer(b))],
      ['messages', () => http.get(`/chats/${chatId}/messages`).set(bearer(b))],
    ];
    // Warm the connection pool / JIT so the first sample is not an outlier.
    for (const [, call] of calls) await call();

    const failures: string[] = [];
    const slowest: Record<string, number> = {};
    for (const [name, call] of calls) {
      let ok = 0;
      slowest[name] = 0;
      for (let i = 0; i < ROUNDS; i++) {
        const started = performance.now();
        const res = await call();
        const ms = performance.now() - started;
        slowest[name] = Math.max(slowest[name], ms);
        if (res.status >= 200 && res.status < 300) ok++;
        else failures.push(`${name} #${i}: ${res.status}`);
      }
      expect({ name, ok }).toEqual({ name, ok: ROUNDS });
    }
    expect(failures).toEqual([]);
    for (const [name, ms] of Object.entries(slowest)) {
      expect({ name, ms: Math.round(ms), ok: ms <= SLOWEST_MS }).toEqual({
        name,
        ms: Math.round(ms),
        ok: true,
      });
    }

    // The attachment link is still signed, just never cached.
    const history = await http
      .get(`/chats/${chatId}/messages`)
      .set(bearer(b))
      .expect(200);
    const withUrl = history.body.items.flatMap((m: any) => m.attachments);
    expect(withUrl).toHaveLength(1);
    expect(withUrl[0].url).toContain('X-Amz-Signature');
  });
});
