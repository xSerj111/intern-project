/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest/socket payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainExceptionFilter } from '@repo/shared';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import {
  type ConnectResult,
  type Session,
  connectSocket,
  login,
  logout,
  registerAndLogin,
  sleep,
  waitFor,
} from './helpers/realtime.helpers';

jest.setTimeout(60000);

describe('Realtime chat, US1 (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let http: ReturnType<typeof request>;
  const sockets: ConnectResult[] = [];

  let a: Session;
  let b: Session;
  let c: Session;
  let chatId: string;

  const track = async (token?: string): Promise<ConnectResult> => {
    const s = await connectSocket(baseUrl, token);
    sockets.push(s);
    return s;
  };
  const authed = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });
  const send = (s: Session, content: string, clientMessageId = randomUUID()) =>
    http
      .post(`/chats/${chatId}/messages`)
      .set(authed(s))
      .send({ clientMessageId, content });
  const summaryFor = async (s: Session) => {
    const res = await http.get('/chats').set(authed(s)).expect(200);
    return res.body.items.find((i: { id: string }) => i.id === chatId);
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
    baseUrl = await app.getUrl();
    baseUrl = baseUrl.replace('[::1]', 'localhost');
    http = request(app.getHttpServer());

    [a, b, c] = await Promise.all([
      registerAndLogin('a'),
      registerAndLogin('b'),
      registerAndLogin('c'),
    ]);
    // Profiles are created lazily on first use (auth's event targets a core
    // instance that is not running here).
    for (const s of [a, b, c]) {
      await http.get('/profiles/me').set(authed(s)).expect(200);
    }
  });

  afterAll(async () => {
    sockets.forEach((s) => s.socket.close());
    await app?.close();
  });

  it('refuses a handshake without a token or with a garbage token', async () => {
    const missing = await track();
    const garbage = await track('garbage.token.value');
    expect(missing.ok).toBe(false);
    expect(garbage.ok).toBe(false);
    expect(!missing.ok && missing.error).toBe('unauthorized');
    expect(!garbage.ok && garbage.error).toBe('unauthorized');
  });

  it('creates a direct chat (201), then returns the same one (200)', async () => {
    const created = await http
      .post('/chats/direct')
      .set(authed(a))
      .send({ userId: b.userId })
      .expect(201);
    chatId = created.body.id;
    const again = await http
      .post('/chats/direct')
      .set(authed(a))
      .send({ userId: b.userId })
      .expect(200);
    expect(again.body.id).toBe(chatId);
  });

  describe('live delivery and privacy', () => {
    let sockA: ConnectResult;
    let sockB: ConnectResult;
    let sockC: ConnectResult;

    beforeAll(async () => {
      [sockA, sockB, sockC] = await Promise.all([
        track(a.accessToken),
        track(b.accessToken),
        track(c.accessToken),
      ]);
      expect([sockA.ok, sockB.ok, sockC.ok]).toEqual([true, true, true]);
    });

    it('delivers message:new to B with the matching seq, and nothing to C', async () => {
      const res = await send(a, 'hi B').expect(201);
      expect(res.body.seq).toBeGreaterThan(0);
      expect(await waitFor(() => sockB.messages.length === 1)).toBe(true);
      expect(sockB.messages[0].message.seq).toBe(res.body.seq);
      expect(sockB.messages[0].message.id).toBe(res.body.id);
      await sleep(300);
      expect(sockC.messages).toHaveLength(0);
    });

    it('returns 404 to an outsider on every chat route', async () => {
      await http.get(`/chats/${chatId}`).set(authed(c)).expect(404);
      await http.get(`/chats/${chatId}/messages`).set(authed(c)).expect(404);
      await send(c, 'let me in').expect(404);
      await sleep(300);
      expect(sockB.messages).toHaveLength(1);
      expect(sockC.messages).toHaveLength(0);
    });

    it('treats a repeated clientMessageId as one message and one event', async () => {
      const clientMessageId = randomUUID();
      const first = await send(b, 'once', clientMessageId).expect(201);
      const replay = await send(b, 'once', clientMessageId).expect(200);
      expect(replay.body.id).toBe(first.body.id);
      expect(replay.body.seq).toBe(first.body.seq);
      await sleep(400);
      const seen = sockA.messages.filter(
        (m) => m.message.clientMessageId === clientMessageId,
      );
      expect(seen).toHaveLength(1);
    });

    it('catches B up after a disconnect, exactly 3 messages in changeSeq order', async () => {
      const before = await http
        .get(`/chats/${chatId}/messages/changes`)
        .query({ afterChangeSeq: 0 })
        .set(authed(b))
        .expect(200);
      const cursor = Math.max(
        ...before.body.items.map((m: { changeSeq: number }) => m.changeSeq),
      );

      sockB.socket.close();
      const sent: string[] = [];
      for (const text of ['m1', 'm2', 'm3']) {
        const r = await send(a, text).expect(201);
        sent.push(r.body.id);
      }

      const reconnected = await track(b.accessToken);
      expect(reconnected.ok).toBe(true);
      const changes = await http
        .get(`/chats/${chatId}/messages/changes`)
        .query({ afterChangeSeq: cursor })
        .set(authed(b))
        .expect(200);
      const items = changes.body.items as Array<{
        id: string;
        changeSeq: number;
      }>;
      expect(items.map((m) => m.id)).toEqual(sent);
      const seqs = items.map((m) => m.changeSeq);
      expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
      expect(changes.body.hasMore).toBe(false);
    });
  });

  describe('real Postgres: seq, unread, preview, read pointer', () => {
    it('assigns gapless increasing seq per chat', async () => {
      const res = await http
        .get(`/chats/${chatId}/messages`)
        .set(authed(a))
        .expect(200);
      const seqs = (res.body.items as Array<{ seq: number }>).map((m) => m.seq);
      const asc = [...seqs].sort((x, y) => x - y);
      // 1 "hi B", 1 "once", 3 catch-up messages
      expect(asc).toEqual([asc[0], ...asc.slice(1)].map((_, i) => asc[0] + i));
      expect(asc).toHaveLength(5);
      // Listing order is strictly monotonic (either direction).
      const desc = [...asc].reverse();
      expect([asc, desc]).toContainEqual(seqs);
    });

    it('counts unread per viewer and previews the last message', async () => {
      // Sending advances the sender's own read pointer. B sent seq 2, so the
      // three later messages from A are unread for B. A's last send (seq 5)
      // covered everything, so A has none.
      const forB = await summaryFor(b);
      const forA = await summaryFor(a);
      expect(forB.unreadCount).toBe(3);
      expect(forA.unreadCount).toBe(0);
      expect(forB.lastMessage.content).toBe('m3');
      expect(forA.lastMessage.content).toBe('m3');

      const msgs = await http
        .get(`/chats/${chatId}/messages`)
        .set(authed(a))
        .expect(200);
      const maxSeq = Math.max(
        ...(msgs.body.items as Array<{ seq: number }>).map((m) => m.seq),
      );
      expect(forB.lastMessage.seq).toBe(maxSeq);
    });

    it('advances the read pointer on markRead and never rewinds it', async () => {
      const msgs = await http
        .get(`/chats/${chatId}/messages`)
        .set(authed(a))
        .expect(200);
      const seqs = (msgs.body.items as Array<{ seq: number }>)
        .map((m) => m.seq)
        .sort((x, y) => x - y);
      const [first, , third, , last] = seqs;

      const toThird = await http
        .post(`/chats/${chatId}/read`)
        .set(authed(b))
        .send({ seq: third })
        .expect(200);
      expect(toThird.body.lastReadSeq).toBe(third);
      // seqs: A, B, A, A, A -> unread for B after the 3rd = seq 4 and 5
      expect(toThird.body.unreadCount).toBe(2);
      expect((await summaryFor(b)).unreadCount).toBe(2);

      const rewind = await http
        .post(`/chats/${chatId}/read`)
        .set(authed(b))
        .send({ seq: first })
        .expect(200);
      expect(rewind.body.lastReadSeq).toBe(third);
      expect((await summaryFor(b)).unreadCount).toBe(2);

      const toEnd = await http
        .post(`/chats/${chatId}/read`)
        .set(authed(b))
        .send({ seq: last })
        .expect(200);
      expect(toEnd.body.lastReadSeq).toBe(last);
      expect(toEnd.body.unreadCount).toBe(0);
      expect((await summaryFor(b)).unreadCount).toBe(0);
    });
  });

  describe('logout', () => {
    it("disconnects A's socket with session:expired { reason: 'revoked' }", async () => {
      const session = await login(a.email);
      const sock = await track(session.accessToken);
      expect(sock.ok).toBe(true);
      expect(await logout(session)).toBe(200);
      expect(await waitFor(() => !sock.socket.connected, 4000)).toBe(true);
      const expired = sock.events.find(([name]) => name === 'session:expired');
      expect(expired?.[1]).toMatchObject({ reason: 'revoked' });
    });
  });
});
