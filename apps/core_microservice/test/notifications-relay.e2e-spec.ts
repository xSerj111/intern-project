/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- supertest/socket payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AmqpConnectionManager } from 'amqp-connection-manager';
import type { Channel } from 'amqplib';
import {
  DomainExceptionFilter,
  EXCHANGE_NAME,
  RoutingKeys,
  type EventEnvelope,
} from '@repo/shared';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { AMQP_CONNECTION } from './../src/common/messaging/amqp-connection.provider';
import {
  type ConnectResult,
  type Session,
  connectSocket,
  eventsNamed,
  logout,
  registerAndLogin,
  retryTransient,
  sleep,
  waitFor,
  warmUpDb,
} from './helpers/realtime.helpers';
import { cleanupE2eData } from './helpers/cleanup.helpers';

jest.setTimeout(90000);

const NOTIFICATIONS_URL =
  process.env.NOTIFICATIONS_SERVICE_URL ?? 'http://localhost:3003';
/** Live delivery budget through the real notifications service (SC-009 is 2 s). */
const PIPELINE_TIMEOUT_MS = 15000;

interface OutboxRow {
  id: string;
  routingKey: string;
  payload: Record<string, any>;
}

describe('Notifications relay and chat alerts, US6 (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let publishChannel: ReturnType<AmqpConnectionManager['createChannel']>;

  const sockets: ConnectResult[] = [];
  const sessions: Session[] = [];
  const postIds: string[] = [];
  const chatIds: string[] = [];
  const outboxIds = new Set<string>();
  let previousRelayQueue: string | undefined;

  const session = async (label: string): Promise<Session> => {
    const s = await registerAndLogin(label);
    sessions.push(s);
    // Profiles are created lazily on first use.
    await retryTransient(() =>
      http.get('/profiles/me').set(authed(s)).expect(200),
    );
    return s;
  };
  const track = async (token: string): Promise<ConnectResult> => {
    const s = await connectSocket(baseUrl, token);
    sockets.push(s);
    expect(s.ok).toBe(true);
    return s;
  };
  const authed = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });
  const rows = <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    db.query(sql, params);

  const publishEnvelope = async (
    routingKey: string,
    payload: unknown,
    raw?: Buffer,
  ): Promise<void> => {
    const envelope: EventEnvelope<unknown> = {
      eventId: randomUUID(),
      type: routingKey,
      version: 1,
      occurredAt: new Date().toISOString(),
      payload,
    };
    await publishChannel.publish(
      EXCHANGE_NAME,
      routingKey,
      raw ?? Buffer.from(JSON.stringify(envelope)),
      { persistent: true, contentType: 'application/json' },
    );
  };

  const snapshot = (recipientId: string, id = randomUUID()) => ({
    id,
    kind: 'POST_LIKED',
    actor: {
      userId: randomUUID(),
      username: 'relay-actor',
      displayName: 'Relay Actor',
      avatarUrl: null,
    },
    target: { type: 'POST', id: randomUUID(), postId: randomUUID() },
    excerpt: null,
    occurredAt: new Date().toISOString(),
    seen: false,
    recipientId,
  });

  const alertedRows = async (
    chatId: string,
    messageId?: string,
  ): Promise<OutboxRow[]> => {
    const found = await rows<OutboxRow>(
      `SELECT id, "routingKey", payload FROM outbox_events
        WHERE "routingKey" = $1 AND payload->>'chatId' = $2
          AND ($3::text IS NULL OR payload->>'messageId' = $3)
        ORDER BY "occurredAt"`,
      [RoutingKeys.CHAT_MESSAGE_ALERTED, chatId, messageId ?? null],
    );
    found.forEach((r) => outboxIds.add(r.id));
    return found;
  };

  const createPublishedPost = async (s: Session): Promise<string> => {
    const created = await http
      .post('/posts')
      .set(authed(s))
      .send({ content: `relay e2e ${randomUUID()}` })
      .expect(201);
    const id: string = created.body.id;
    postIds.push(id);
    await http.post(`/posts/${id}/publish`).set(authed(s)).expect(201);
    return id;
  };

  beforeAll(async () => {
    // A private relay queue: parallel suites' apps would otherwise compete
    // for deliveries on the shared `core.realtime-relay` queue.
    previousRelayQueue = process.env.NOTIFICATIONS_RELAY_QUEUE;
    process.env.NOTIFICATIONS_RELAY_QUEUE = `core.realtime-relay.e2e-${randomUUID()}`;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.listen(0);
    baseUrl = (await app.getUrl()).replace('[::1]', 'localhost');
    http = request(app.getHttpServer());
    db = app.get(DataSource);
    await warmUpDb(db);

    // Publish through the app's own broker connection (no extra dependency).
    publishChannel = app
      .get<AmqpConnectionManager>(AMQP_CONNECTION)
      .createChannel({
        name: 'relay-e2e-publisher',
        setup: (ch: Channel) =>
          ch.assertExchange(EXCHANGE_NAME, 'topic', { durable: true }),
      });
    await publishChannel.waitForConnect();
  });

  afterAll(async () => {
    sockets.forEach((s) => s.socket.close());
    // Best-effort cleanup of chats, posts and outbox rows, then users and profiles.
    try {
      if (chatIds.length) {
        await rows(
          'DELETE FROM message_assets WHERE "messageId" IN (SELECT id FROM messages WHERE "chatId" = ANY($1))',
          [chatIds],
        );
        await rows('DELETE FROM messages WHERE "chatId" = ANY($1)', [chatIds]);
        await rows('DELETE FROM chat_participants WHERE "chatId" = ANY($1)', [
          chatIds,
        ]);
        await rows('DELETE FROM chats WHERE id = ANY($1)', [chatIds]);
      }
      if (postIds.length) {
        await rows('DELETE FROM post_likes WHERE "postId" = ANY($1)', [
          postIds,
        ]);
        await rows('DELETE FROM posts WHERE id = ANY($1)', [postIds]);
      }
      if (outboxIds.size) {
        await rows('DELETE FROM outbox_events WHERE id = ANY($1)', [
          [...outboxIds],
        ]);
      }
    } catch (err) {
      console.warn('relay e2e cleanup failed', err);
    }
    await Promise.all(sessions.map((s) => logout(s).catch(() => 0)));
    try {
      if (db) await cleanupE2eData(db);
    } catch (err) {
      console.warn('relay e2e user cleanup failed', err);
    }
    await publishChannel?.close().catch(() => undefined);
    await app?.close();
    if (previousRelayQueue === undefined) {
      delete process.env.NOTIFICATIONS_RELAY_QUEUE;
    } else {
      process.env.NOTIFICATIONS_RELAY_QUEUE = previousRelayQueue;
    }
  });

  describe('relay of notification.* broker events', () => {
    let recipient: Session;
    let rSock1: ConnectResult;
    let rSock2: ConnectResult;
    let bystander: Session;
    let bSock: ConnectResult;

    beforeAll(async () => {
      [recipient, bystander] = await Promise.all([
        session('rly-r'),
        session('rly-x'),
      ]);
      [rSock1, rSock2, bSock] = await Promise.all([
        track(recipient.accessToken),
        track(recipient.accessToken),
        track(bystander.accessToken),
      ]);
    });

    it('emits notification:new with the unseen count to every socket of the recipient only', async () => {
      const note = snapshot(recipient.userId);
      const { recipientId, ...notification } = note;
      await publishEnvelope(RoutingKeys.NOTIFICATION_CREATED, {
        recipientId,
        notification,
        unseenCount: 3,
      });

      for (const sock of [rSock1, rSock2]) {
        expect(
          await waitFor(
            () => eventsNamed(sock, 'notification:new').length === 1,
            8000,
          ),
        ).toBe(true);
        expect(eventsNamed(sock, 'notification:new')[0]).toEqual({
          notification,
          unseenCount: 3,
        });
      }
      await sleep(300);
      expect(eventsNamed(bSock, 'notification:new')).toHaveLength(0);
    });

    it('emits notifications:seen { unseenCount: 0 } to the user on notification.seen', async () => {
      await publishEnvelope(RoutingKeys.NOTIFICATION_SEEN, {
        userId: recipient.userId,
        unseenCount: 0,
      });
      for (const sock of [rSock1, rSock2]) {
        expect(
          await waitFor(
            () => eventsNamed(sock, 'notifications:seen').length === 1,
            8000,
          ),
        ).toBe(true);
        expect(eventsNamed(sock, 'notifications:seen')[0]).toEqual({
          unseenCount: 0,
        });
      }
      expect(eventsNamed(bSock, 'notifications:seen')).toHaveLength(0);
    });

    it('drops invalid or malformed events without breaking the consumer', async () => {
      const before = eventsNamed(rSock1, 'notification:new').length;
      // Bad payload shape, non-JSON body, unknown key under the binding.
      await publishEnvelope(RoutingKeys.NOTIFICATION_CREATED, {
        recipientId: 'not-a-uuid',
        notification: 'nope',
        unseenCount: -4,
      });
      await publishEnvelope(
        RoutingKeys.NOTIFICATION_CREATED,
        null,
        Buffer.from('this is not json'),
      );
      await publishEnvelope('notification.unknown', {
        recipientId: recipient.userId,
      });
      // A valid event after them must still arrive.
      const { recipientId, ...notification } = snapshot(recipient.userId);
      await publishEnvelope(RoutingKeys.NOTIFICATION_CREATED, {
        recipientId,
        notification,
        unseenCount: 1,
      });

      expect(
        await waitFor(
          () => eventsNamed(rSock1, 'notification:new').length === before + 1,
          8000,
        ),
      ).toBe(true);
      await sleep(300);
      const received = eventsNamed(rSock1, 'notification:new');
      expect(received).toHaveLength(before + 1);
      expect(received[before]).toEqual({ notification, unseenCount: 1 });
    });
  });

  describe('post like through the notifications service', () => {
    let author: Session; // B: owns the post
    let liker: Session; // A: likes it
    let bSock1: ConnectResult;
    let bSock2: ConnectResult;
    let postId: string;

    beforeAll(async () => {
      [author, liker] = await Promise.all([session('lk-b'), session('lk-a')]);
      [bSock1, bSock2] = await Promise.all([
        track(author.accessToken),
        track(author.accessToken),
      ]);
      postId = await createPublishedPost(author);
    });

    it('delivers notification:new (POST_LIKED, unseenCount 1) to B', async () => {
      await http.put(`/posts/${postId}/like`).set(authed(liker)).expect(200);

      expect(
        await waitFor(
          () => eventsNamed(bSock1, 'notification:new').length >= 1,
          PIPELINE_TIMEOUT_MS,
        ),
      ).toBe(true);
      const [event] = eventsNamed(bSock1, 'notification:new');
      expect(event.unseenCount).toBe(1);
      expect(event.notification).toMatchObject({
        kind: 'POST_LIKED',
        seen: false,
        actor: { userId: liker.userId },
        target: { type: 'POST', id: postId },
      });
      expect(
        await waitFor(
          () => eventsNamed(bSock2, 'notification:new').length >= 1,
        ),
      ).toBe(true);
    });

    it('POST /notifications/seen in one session emits notifications:seen to the other socket', async () => {
      const res = await fetch(`${NOTIFICATIONS_URL}/notifications/seen`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authed(author),
        },
        body: '{}',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ unseenCount: 0 });

      expect(
        await waitFor(
          () => eventsNamed(bSock2, 'notifications:seen').length >= 1,
          PIPELINE_TIMEOUT_MS,
        ),
      ).toBe(true);
      expect(eventsNamed(bSock2, 'notifications:seen')[0]).toEqual({
        unseenCount: 0,
      });
    });

    it('unlike then like again produces no second notification:new', async () => {
      await http.delete(`/posts/${postId}/like`).set(authed(liker)).expect(200);
      await http.put(`/posts/${postId}/like`).set(authed(liker)).expect(200);
      await http.delete(`/posts/${postId}/like`).set(authed(liker)).expect(200);
      await http.put(`/posts/${postId}/like`).set(authed(liker)).expect(200);

      // Give the outbox and the broker time to deliver anything that would come.
      await sleep(5000);
      expect(eventsNamed(bSock1, 'notification:new')).toHaveLength(1);
      expect(eventsNamed(bSock2, 'notification:new')).toHaveLength(1);
    });
  });

  describe('chat:alert and chat.message.alerted outbox rows', () => {
    let a: Session; // sender
    let b: Session; // recipient, not viewing
    let c: Session; // recipient, viewing the chat
    let sockA: ConnectResult;
    let sockB: ConnectResult;
    let sockC: ConnectResult;
    let chatId: string;

    const send = (content: string, clientMessageId = randomUUID()) =>
      http
        .post(`/chats/${chatId}/messages`)
        .set(authed(a))
        .send({ clientMessageId, content });

    beforeAll(async () => {
      [a, b, c] = await Promise.all([
        session('al-a'),
        session('al-b'),
        session('al-c'),
      ]);
      const group = await http
        .post('/chats/groups')
        .set(authed(a))
        .send({ title: 'relay e2e group', memberIds: [b.userId, c.userId] })
        .expect(201);
      chatId = group.body.id;
      chatIds.push(chatId);

      // Sockets connect after the group exists so they join its room.
      [sockA, sockB, sockC] = await Promise.all([
        track(a.accessToken),
        track(b.accessToken),
        track(c.accessToken),
      ]);
      const ack = await new Promise<unknown>((resolve) =>
        sockC.socket.emit('chat:view', { chatId }, resolve),
      );
      expect(ack).toEqual({ ok: true });
    });

    it('commits one alert row with the message for the non-viewing recipient only', async () => {
      const res = await send('hello group').expect(201);
      const messageId: string = res.body.id;

      // The row is already there when the HTTP response returns: same tx.
      const found = await alertedRows(chatId, messageId);
      expect(found).toHaveLength(1);
      expect(found[0].payload).toMatchObject({
        recipientId: b.userId,
        chatId,
        messageId,
        chatTitle: 'relay e2e group',
        preview: 'hello group',
        actor: { userId: a.userId },
      });
      const recipients = (await alertedRows(chatId)).map(
        (r) => r.payload.recipientId,
      );
      expect(recipients).not.toContain(a.userId);
      expect(recipients).not.toContain(c.userId);
    });

    it('emits chat:alert to the non-viewing recipient and not to the viewer or the sender', async () => {
      expect(
        await waitFor(() => eventsNamed(sockB, 'chat:alert').length === 1),
      ).toBe(true);
      const [alert] = eventsNamed(sockB, 'chat:alert');
      expect(alert).toMatchObject({
        chatId,
        chatTitle: 'relay e2e group',
        preview: 'hello group',
        actor: { userId: a.userId },
      });
      await sleep(300);
      expect(eventsNamed(sockC, 'chat:alert')).toHaveLength(0);
      expect(eventsNamed(sockA, 'chat:alert')).toHaveLength(0);
    });

    it('adds no second row or alert for an idempotent resend', async () => {
      const clientMessageId = randomUUID();
      const first = await send('once', clientMessageId).expect(201);
      const replay = await send('once', clientMessageId).expect(200);
      expect(replay.body.id).toBe(first.body.id);

      expect(await alertedRows(chatId, first.body.id)).toHaveLength(1);
      await sleep(300);
      // One alert for 'hello group', one for 'once'.
      expect(eventsNamed(sockB, 'chat:alert')).toHaveLength(2);
    });

    it('alerts a recipient again once they stop viewing (chat:view null)', async () => {
      const ack = await new Promise<unknown>((resolve) =>
        sockC.socket.emit('chat:view', { chatId: null }, resolve),
      );
      expect(ack).toEqual({ ok: true });
      const res = await send('now C is away').expect(201);

      const found = await alertedRows(chatId, res.body.id);
      expect(found.map((r) => r.payload.recipientId).sort()).toEqual(
        [b.userId, c.userId].sort(),
      );
      expect(
        await waitFor(() => eventsNamed(sockC, 'chat:alert').length === 1),
      ).toBe(true);
    });

    it('adds no chat.message.alerted row for a SYSTEM message (group rename)', async () => {
      const before = (await alertedRows(chatId)).length;
      await http
        .patch(`/chats/${chatId}`)
        .set(authed(a))
        .send({ title: 'renamed relay group' })
        .expect(200);
      const system = await rows(
        `SELECT id FROM messages WHERE "chatId" = $1 AND kind = 'SYSTEM'`,
        [chatId],
      );
      expect(system.length).toBeGreaterThan(0);
      await sleep(300);
      expect(await alertedRows(chatId)).toHaveLength(before);
    });
  });
});
