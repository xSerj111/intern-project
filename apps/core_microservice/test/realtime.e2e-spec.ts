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
  eventsNamed,
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

  describe('groups', () => {
    let d: Session;
    let gid: string;
    let sa: ConnectResult;
    let sb: ConnectResult;
    let sc: ConnectResult;
    let sd: ConnectResult;
    let reAddedSeq: number;
    const unknownUser = randomUUID();

    const sendTo = (s: Session, content: string) =>
      http
        .post(`/chats/${gid}/messages`)
        .set(authed(s))
        .send({ clientMessageId: randomUUID(), content });
    const listFor = async (s: Session) => {
      const res = await http
        .get(`/chats/${gid}/messages`)
        .set(authed(s))
        .expect(200);
      return res.body.items as Array<{
        seq: number;
        kind: string;
        content: string | null;
        systemEvent: { type: string; targetUserIds?: string[] } | null;
      }>;
    };
    const systemTypes = (s: ConnectResult) =>
      s.messages
        .filter((m) => m.message.chatId === gid && m.message.kind === 'SYSTEM')
        .map((m) => m.message.systemEvent.type);
    const detailFor = async (s: Session) =>
      (await http.get(`/chats/${gid}`).set(authed(s)).expect(200)).body;

    beforeAll(async () => {
      d = await registerAndLogin('d');
      await http.get('/profiles/me').set(authed(d)).expect(200);
      [sa, sb, sc, sd] = await Promise.all([
        track(a.accessToken),
        track(b.accessToken),
        track(c.accessToken),
        track(d.accessToken),
      ]);
      expect([sa.ok, sb.ok, sc.ok, sd.ok]).toEqual([true, true, true, true]);
    });

    it('rejects groups with fewer than 2 other members, or an unknown user', async () => {
      await http
        .post('/chats/groups')
        .set(authed(a))
        .send({ title: 'Too small', memberIds: [b.userId] })
        .expect(400);
      await http
        .post('/chats/groups')
        .set(authed(a))
        .send({ title: '', memberIds: [b.userId, c.userId] })
        .expect(400);
      await http
        .post('/chats/groups')
        .set(authed(a))
        .send({ title: 'Ghost', memberIds: [b.userId, unknownUser] })
        .expect(404);
    });

    it('creates a group with A as admin, upserting it to every member with a group_created line', async () => {
      const res = await http
        .post('/chats/groups')
        .set(authed(a))
        .send({ title: 'Weekend Trip', memberIds: [b.userId, c.userId] })
        .expect(201);
      gid = res.body.id;
      expect(res.body.type).toBe('GROUP');
      expect(res.body.title).toBe('Weekend Trip');
      expect(res.body.myRole).toBe('ADMIN');
      expect(res.body.memberCount).toBe(3);
      const roles = Object.fromEntries(
        (res.body.participants as Array<{ userId: string; role: string }>).map(
          (p) => [p.userId, p.role],
        ),
      );
      expect(roles).toEqual({
        [a.userId]: 'ADMIN',
        [b.userId]: 'MEMBER',
        [c.userId]: 'MEMBER',
      });

      const upserted = (s: ConnectResult) =>
        eventsNamed(s, 'chat:upsert').some((e) => e.conversation.id === gid);
      expect(await waitFor(() => [sa, sb, sc].every(upserted))).toBe(true);
      expect(upserted(sd)).toBe(false);
      expect(
        await waitFor(() =>
          [sa, sb, sc].every((s) => systemTypes(s).includes('group_created')),
        ),
      ).toBe(true);
      const created = sb.messages.find(
        (m) => m.message.systemEvent?.type === 'group_created',
      ).message;
      expect(created.systemEvent.actorId).toBe(a.userId);
      expect(created.authorId).toBe(a.userId);
      expect(created.content).toBeNull();
    });

    it('delivers each member message live to the other two', async () => {
      const heard = (s: ConnectResult, text: string) =>
        s.messages.some((m) => m.message.content === text);
      await sendTo(a, 'from A').expect(201);
      await sendTo(b, 'from B').expect(201);
      await sendTo(c, 'from C').expect(201);
      expect(
        await waitFor(
          () =>
            heard(sa, 'from B') &&
            heard(sa, 'from C') &&
            heard(sb, 'from A') &&
            heard(sb, 'from C') &&
            heard(sc, 'from A') &&
            heard(sc, 'from B'),
        ),
      ).toBe(true);
    });

    it('returns 403 to a non-admin who renames, adds, removes or promotes', async () => {
      await http
        .patch(`/chats/${gid}`)
        .set(authed(b))
        .send({ title: 'Mine now' })
        .expect(403);
      await http
        .post(`/chats/${gid}/members`)
        .set(authed(b))
        .send({ userIds: [d.userId] })
        .expect(403);
      await http
        .delete(`/chats/${gid}/members/${c.userId}`)
        .set(authed(b))
        .expect(403);
      await http
        .post(`/chats/${gid}/members/${c.userId}/promote`)
        .set(authed(b))
        .expect(403);
      expect((await detailFor(a)).title).toBe('Weekend Trip');
      expect((await detailFor(a)).memberCount).toBe(3);
    });

    it('lets the admin rename, with a group_renamed line and a list update', async () => {
      const before = eventsNamed(sb, 'chat:upsert').length;
      const res = await http
        .patch(`/chats/${gid}`)
        .set(authed(a))
        .send({ title: 'Weekend Trip 2' })
        .expect(200);
      expect(res.body.title).toBe('Weekend Trip 2');
      expect(
        await waitFor(() => systemTypes(sb).includes('group_renamed')),
      ).toBe(true);
      expect(
        await waitFor(() => eventsNamed(sb, 'chat:upsert').length > before),
      ).toBe(true);
    });

    it('adds D, who sees member_added but nothing earlier, then gets new messages', async () => {
      const res = await http
        .post(`/chats/${gid}/members`)
        .set(authed(a))
        .send({ userIds: [d.userId] })
        .expect(200);
      expect(res.body.memberCount).toBe(4);
      expect(
        await waitFor(() =>
          eventsNamed(sd, 'chat:upsert').some((e) => e.conversation.id === gid),
        ),
      ).toBe(true);
      expect(
        await waitFor(() => systemTypes(sd).includes('member_added')),
      ).toBe(true);
      expect(
        await waitFor(() => systemTypes(sb).includes('member_added')),
      ).toBe(true);

      const history = await listFor(d);
      expect(history).toHaveLength(1);
      expect(history[0].systemEvent?.type).toBe('member_added');
      expect(history[0].systemEvent?.targetUserIds).toEqual([d.userId]);
      await http
        .get(`/chats/${gid}/messages/changes`)
        .query({ afterChangeSeq: 0 })
        .set(authed(d))
        .expect(200)
        .expect((r) => {
          expect(r.body.items).toHaveLength(1);
        });

      await sendTo(a, 'welcome D').expect(201);
      expect(
        await waitFor(() =>
          sd.messages.some((m) => m.message.content === 'welcome D'),
        ),
      ).toBe(true);
    });

    it('removes C: chat:removed arrives, then no more events, and the chat is 404', async () => {
      await http
        .delete(`/chats/${gid}/members/${c.userId}`)
        .set(authed(a))
        .expect(204);
      expect(
        await waitFor(() => eventsNamed(sc, 'chat:removed').length === 1),
      ).toBe(true);
      expect(eventsNamed(sc, 'chat:removed')[0]).toEqual({
        chatId: gid,
        reason: 'removed',
      });
      expect(
        await waitFor(() => systemTypes(sb).includes('member_removed')),
      ).toBe(true);

      const removedAt = sc.events.findIndex(([n]) => n === 'chat:removed');
      const seenByC = sc.events.length;
      await sendTo(a, 'C cannot hear this').expect(201);
      expect(
        await waitFor(() =>
          sb.messages.some((m) => m.message.content === 'C cannot hear this'),
        ),
      ).toBe(true);
      await sleep(300);
      // Nothing after chat:removed, and the removal line itself never reached C.
      expect(sc.events.slice(removedAt + 1)).toEqual([]);
      expect(sc.events.length).toBe(seenByC);
      expect(
        sc.messages.some((m) => m.message.content === 'C cannot hear this'),
      ).toBe(false);
      expect(systemTypes(sc)).not.toContain('member_removed');

      await http.get(`/chats/${gid}`).set(authed(c)).expect(404);
      await http.get(`/chats/${gid}/messages`).set(authed(c)).expect(404);
      await sendTo(c, 'still here?').expect(404);
      const list = await http.get('/chats').set(authed(c)).expect(200);
      expect(
        (list.body.items as Array<{ id: string }>).some((i) => i.id === gid),
      ).toBe(false);
    });

    it('re-adds C (reactivating the row): nothing from before or while away is visible', async () => {
      const upsertsBefore = eventsNamed(sc, 'chat:upsert').length;
      await sendTo(b, 'while C is away').expect(201);
      const res = await http
        .post(`/chats/${gid}/members`)
        .set(authed(a))
        .send({ userIds: [c.userId] })
        .expect(200);
      expect(res.body.memberCount).toBe(4);
      const role = (
        res.body.participants as Array<{ userId: string; role: string }>
      ).find((p) => p.userId === c.userId)?.role;
      expect(role).toBe('MEMBER');

      expect(
        await waitFor(
          () => eventsNamed(sc, 'chat:upsert').length > upsertsBefore,
        ),
      ).toBe(true);
      expect(
        await waitFor(() => systemTypes(sc).includes('member_added')),
      ).toBe(true);

      const history = await listFor(c);
      expect(history).toHaveLength(1);
      expect(history[0].kind).toBe('SYSTEM');
      expect(history[0].systemEvent?.type).toBe('member_added');
      expect(history[0].systemEvent?.targetUserIds).toEqual([c.userId]);
      reAddedSeq = history[0].seq;
      const contents = history.map((m) => m.content);
      expect(contents).not.toContain('from A');
      expect(contents).not.toContain('C cannot hear this');
      expect(contents).not.toContain('while C is away');

      const changes = await http
        .get(`/chats/${gid}/messages/changes`)
        .query({ afterChangeSeq: 0 })
        .set(authed(c))
        .expect(200);
      expect(
        (changes.body.items as Array<{ seq: number }>).every(
          (m) => m.seq >= reAddedSeq,
        ),
      ).toBe(true);

      // Live again, and sees only what follows.
      await sendTo(d, 'hello again C').expect(201);
      expect(
        await waitFor(() =>
          sc.messages.some((m) => m.message.content === 'hello again C'),
        ),
      ).toBe(true);
      const after = await listFor(c);
      expect(after.every((m) => m.seq >= reAddedSeq)).toBe(true);
      expect(after).toHaveLength(2);
    });

    it('lets B leave: chat:removed reason left, others see member_left, then 404', async () => {
      await http.post(`/chats/${gid}/leave`).set(authed(b)).expect(204);
      expect(
        await waitFor(() => eventsNamed(sb, 'chat:removed').length === 1),
      ).toBe(true);
      expect(eventsNamed(sb, 'chat:removed')[0]).toEqual({
        chatId: gid,
        reason: 'left',
      });
      expect(
        await waitFor(
          () =>
            systemTypes(sa).includes('member_left') &&
            systemTypes(sd).includes('member_left'),
        ),
      ).toBe(true);
      await http.get(`/chats/${gid}`).set(authed(b)).expect(404);
      expect((await detailFor(a)).memberCount).toBe(3);
    });

    it('promotes the earliest-joined member when the only admin leaves', async () => {
      await http.post(`/chats/${gid}/leave`).set(authed(a)).expect(204);
      expect(
        await waitFor(() => systemTypes(sd).includes('admin_promoted')),
      ).toBe(true);
      const promoted = sd.messages.find(
        (m) => m.message.systemEvent?.type === 'admin_promoted',
      ).message;
      // D joined before C was re-added.
      expect(promoted.systemEvent.targetUserIds).toEqual([d.userId]);
      expect(eventsNamed(sa, 'chat:removed').at(-1)).toEqual({
        chatId: gid,
        reason: 'left',
      });

      const detail = await detailFor(d);
      expect(detail.myRole).toBe('ADMIN');
      expect(detail.memberCount).toBe(2);
      const roles = Object.fromEntries(
        (detail.participants as Array<{ userId: string; role: string }>).map(
          (p) => [p.userId, p.role],
        ),
      );
      expect(roles).toEqual({ [d.userId]: 'ADMIN', [c.userId]: 'MEMBER' });
      expect((await detailFor(c)).myRole).toBe('MEMBER');
    });

    it('lets the admin promote a member, and 404s a former member', async () => {
      await http
        .post(`/chats/${gid}/members/${c.userId}/promote`)
        .set(authed(a))
        .expect(404);
      const res = await http
        .post(`/chats/${gid}/members/${c.userId}/promote`)
        .set(authed(d))
        .expect(200);
      const mine = (
        res.body.participants as Array<{ userId: string; role: string }>
      ).find((p) => p.userId === c.userId);
      expect(mine?.role).toBe('ADMIN');
      // C already saw D's promotion (it was a member then); this is the second.
      const promotions = () =>
        sc.messages.filter(
          (m) => m.message.systemEvent?.type === 'admin_promoted',
        );
      expect(await waitFor(() => promotions().length === 2)).toBe(true);
      expect(promotions()[1].message.systemEvent.targetUserIds).toEqual([
        c.userId,
      ]);
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
