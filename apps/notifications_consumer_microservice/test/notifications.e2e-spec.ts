/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DomainExceptionFilter,
  RoutingKeys,
  type EventEnvelope,
  type RoutingKey,
} from '@repo/shared';
import { connect } from 'amqplib';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { EVENTS_QUEUE } from './../src/common/messaging/amqp-topology';
import { AppConfigService } from './../src/config/app-config.service';
import { MessageAlertHandler } from './../src/modules/notifications/application/message-alert.handler';
import { SocialEventHandler } from './../src/modules/notifications/application/social-event.handler';
import { EmailDelivery } from './../src/modules/notifications/domain/entities/email-delivery.entity';
import {
  Notification,
  type SocialEventPayload,
} from './../src/modules/notifications/domain/entities/notification.entity';
import { ProcessedEvent } from './../src/modules/notifications/domain/entities/processed-event.entity';
import { RecipientContact } from './../src/modules/notifications/domain/entities/recipient-contact.entity';
import {
  EMAIL_DELIVERY_REPOSITORY,
  type IEmailDeliveryRepository,
} from './../src/modules/notifications/domain/interfaces/email-delivery-repository.port';
import {
  EVENT_BUS,
  type IEventBus,
} from './../src/modules/notifications/domain/interfaces/event-bus.port';
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from './../src/modules/notifications/domain/interfaces/notification-repository.port';
import {
  PROCESSED_EVENT_REPOSITORY,
  type IProcessedEventRepository,
} from './../src/modules/notifications/domain/interfaces/processed-event-repository.port';
import {
  RECIPIENT_CONTACT_REPOSITORY,
  type IRecipientContactRepository,
} from './../src/modules/notifications/domain/interfaces/recipient-contact-repository.port';
import { NotificationPreferences } from './../src/modules/preferences/domain/entities/notification-preferences.entity';
import {
  PREFERENCES_REPOSITORY,
  type IPreferencesRepository,
} from './../src/modules/preferences/domain/interfaces/preferences-repository.port';

jest.setTimeout(60000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Notifications service (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: DataSource;
  let jwtSecret: string;
  let amqpUrl: string;

  let notifications: INotificationRepository;
  let processedEvents: IProcessedEventRepository;
  let deliveries: IEmailDeliveryRepository;
  let contacts: IRecipientContactRepository;
  let preferences: IPreferencesRepository;
  let bus: IEventBus;
  let social: SocialEventHandler;
  let alerts: MessageAlertHandler;

  // Everything created by this run, removed in afterAll.
  const userIds = new Set<string>();
  const eventIds = new Set<string>();
  const jobIds = new Set<string>();

  const newUser = (): string => {
    const id = randomUUID();
    userIds.add(id);
    return id;
  };
  const newEventId = (): string => {
    const id = randomUUID();
    eventIds.add(id);
    return id;
  };
  const tokenFor = (sub: string): string =>
    jwt.sign({ sub, email: `${sub}@e2e.test`, jti: randomUUID() }, jwtSecret, {
      algorithm: 'HS256',
      expiresIn: '10m',
    });
  const authed = (sub: string) => ({
    Authorization: `Bearer ${tokenFor(sub)}`,
  });

  const actorOf = (userId: string) => ({
    userId,
    username: `u${userId.slice(0, 6)}`,
    displayName: `User ${userId.slice(0, 6)}`,
    avatarUrl: null,
  });

  const envelope = <T>(
    type: RoutingKey,
    payload: T,
    options: { eventId?: string; occurredAt?: Date } = {},
  ): EventEnvelope<T> => ({
    eventId: options.eventId ?? newEventId(),
    type,
    version: 1,
    occurredAt: (options.occurredAt ?? new Date()).toISOString(),
    payload,
  });

  const followed = (
    recipientId: string,
    actorId: string,
    options: { eventId?: string; occurredAt?: Date } = {},
  ) =>
    envelope<SocialEventPayload>(
      RoutingKeys.USER_FOLLOWED,
      { actor: actorOf(actorId), recipientId },
      options,
    );

  const postLiked = (
    recipientId: string,
    actorId: string,
    postId: string,
    options: { eventId?: string; occurredAt?: Date } = {},
  ) =>
    envelope<SocialEventPayload>(
      RoutingKeys.POST_LIKED,
      { actor: actorOf(actorId), recipientId, postId, excerpt: 'a post' },
      options,
    );

  const commented = (
    recipientId: string,
    actorId: string,
    options: { eventId?: string; occurredAt?: Date } = {},
  ) =>
    envelope<SocialEventPayload>(
      RoutingKeys.POST_COMMENTED,
      {
        actor: actorOf(actorId),
        recipientId,
        postId: randomUUID(),
        commentId: randomUUID(),
        excerpt: 'nice',
      },
      options,
    );

  /** Builds the entity from an envelope; asserts it is not a self-action. */
  const entityOf = (env: EventEnvelope<SocialEventPayload>): Notification => {
    const n = Notification.fromEvent(env);
    if (!n) throw new Error('self action');
    return n;
  };

  const insertOne = (n: Notification): Promise<boolean> =>
    notifications.runInTransaction((tx) => notifications.insert(n, tx));

  const rows = <T = any>(sql: string, params: unknown[] = []): Promise<T[]> =>
    db.query(sql, params);
  const countFor = async (recipientId: string): Promise<number> =>
    Number(
      (
        await rows(
          'SELECT count(*)::int AS n FROM notifications WHERE "recipientId" = $1',
          [recipientId],
        )
      )[0].n,
    );

  /** Turns every email switch off, so no email job reaches the broker. */
  const muteEmail = async (userId: string): Promise<void> => {
    const prefs = NotificationPreferences.defaults(userId);
    prefs.update({
      emailMessages: false,
      emailComments: false,
      emailLikes: false,
      emailFollows: false,
    });
    await preferences.save(prefs);
  };

  const pollUntil = async <T>(
    probe: () => Promise<T>,
    ok: (v: T) => boolean,
    timeoutMs = 15000,
  ): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    let last = await probe();
    while (!ok(last) && Date.now() < deadline) {
      await sleep(100);
      last = await probe();
    }
    return last;
  };

  /**
   * Removes the dead-lettered copy of one event from the DLQ, so a run leaves
   * nothing behind. Other messages are put back untouched. Returns whether the
   * event's message was found before the timeout.
   */
  const removeFromDlq = async (
    eventId: string,
    timeoutMs = 5000,
  ): Promise<boolean> => {
    const conn = await connect(amqpUrl);
    try {
      const channel = await conn.createChannel();
      const others: Awaited<ReturnType<typeof channel.get>>[] = [];
      let found = false;
      const deadline = Date.now() + timeoutMs;
      while (!found && Date.now() < deadline) {
        const msg = await channel.get(EVENTS_QUEUE.deadLetterQueue!);
        if (msg === false) {
          await sleep(100);
          continue;
        }
        if (msg.content.toString().includes(eventId)) {
          channel.ack(msg);
          found = true;
        } else {
          others.push(msg);
        }
      }
      for (const msg of others) {
        if (msg !== false) channel.nack(msg, false, true);
      }
      await channel.close();
      return found;
    } finally {
      await conn.close();
    }
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Same global pipe and filter as main.ts.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.listen(0);
    http = request(app.getHttpServer());
    db = app.get(DataSource);
    jwtSecret = app.get(AppConfigService).jwtSecret;
    amqpUrl = app.get(AppConfigService).rabbitmq.url;

    notifications = app.get<INotificationRepository>(NOTIFICATION_REPOSITORY);
    processedEvents = app.get<IProcessedEventRepository>(
      PROCESSED_EVENT_REPOSITORY,
    );
    deliveries = app.get<IEmailDeliveryRepository>(EMAIL_DELIVERY_REPOSITORY);
    contacts = app.get<IRecipientContactRepository>(
      RECIPIENT_CONTACT_REPOSITORY,
    );
    preferences = app.get<IPreferencesRepository>(PREFERENCES_REPOSITORY);
    bus = app.get<IEventBus>(EVENT_BUS);
    social = app.get(SocialEventHandler);
    alerts = app.get(MessageAlertHandler);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      const users = [...userIds];
      const events = [...eventIds];
      if (users.length) {
        await rows('DELETE FROM notifications WHERE "recipientId" = ANY($1)', [
          users,
        ]);
        await rows(
          'DELETE FROM email_deliveries WHERE "recipientId" = ANY($1)',
          [users],
        );
        await rows('DELETE FROM recipient_contacts WHERE "userId" = ANY($1)', [
          users,
        ]);
        await rows(
          'DELETE FROM notification_preferences WHERE "userId" = ANY($1)',
          [users],
        );
      }
      if (events.length) {
        await rows(
          'DELETE FROM notifications WHERE "sourceEventId" = ANY($1)',
          [events],
        );
        await rows('DELETE FROM processed_events WHERE "eventId" = ANY($1)', [
          events,
        ]);
      }
      if (jobIds.size) {
        await rows('DELETE FROM email_deliveries WHERE "jobId" = ANY($1)', [
          [...jobIds],
        ]);
      }
    } finally {
      await app.close();
    }
  });

  describe('NotificationRepository', () => {
    it('insert stores the row and findBySourceEventId returns it', async () => {
      const recipient = newUser();
      const env = followed(recipient, newUser());
      const n = entityOf(env);

      expect(await insertOne(n)).toBe(true);

      const found = await notifications.findBySourceEventId(env.eventId);
      expect(found).toMatchObject({
        id: n.id,
        recipientId: recipient,
        kind: 'USER_FOLLOWED',
        targetType: 'PROFILE',
        seenAt: null,
      });
      expect(await notifications.findBySourceEventId(randomUUID())).toBeNull();
    });

    it('insert returns false on a repeated sourceEventId and keeps the tx usable', async () => {
      const recipient = newUser();
      const env = followed(recipient, newUser());
      expect(await insertOne(entityOf(env))).toBe(true);

      const other = entityOf(followed(recipient, newUser()));
      const outcome = await notifications.runInTransaction(async (tx) => {
        // Same eventId, different row id: hits UQ_notifications_sourceEventId.
        const dup = await notifications.insert(entityOf(env), tx);
        // A failed statement would abort the tx; this proves it did not.
        const next = await notifications.insert(other, tx);
        return { dup, next };
      });

      expect(outcome).toEqual({ dup: false, next: true });
      expect(await countFor(recipient)).toBe(2);
    });

    it('insert treats the like partial-unique conflict as a duplicate, other kinds are not limited', async () => {
      const recipient = newUser();
      const actor = newUser();
      const postId = randomUUID();

      expect(
        await insertOne(entityOf(postLiked(recipient, actor, postId))),
      ).toBe(true);
      // New eventId, same recipient/kind/actor/target.
      const dup = await notifications.runInTransaction(async (tx) => {
        const conflicted = await notifications.insert(
          entityOf(postLiked(recipient, actor, postId)),
          tx,
        );
        const other = await notifications.insert(
          entityOf(postLiked(recipient, actor, randomUUID())),
          tx,
        );
        return { conflicted, other };
      });
      expect(dup).toEqual({ conflicted: false, other: true });
      expect(await countFor(recipient)).toBe(2);

      // The index is partial: repeated follows by the same actor both store.
      const follower = newUser();
      expect(await insertOne(entityOf(followed(recipient, follower)))).toBe(
        true,
      );
      expect(await insertOne(entityOf(followed(recipient, follower)))).toBe(
        true,
      );
    });

    it('runInTransaction rolls back when the work throws', async () => {
      const recipient = newUser();
      const env = followed(recipient, newUser());

      await expect(
        notifications.runInTransaction(async (tx) => {
          await notifications.insert(entityOf(env), tx);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(await notifications.findBySourceEventId(env.eventId)).toBeNull();
    });

    it('page returns newest first with an exclusive before cursor and hasMore', async () => {
      const recipient = newUser();
      const base = Date.now() - 3_600_000;
      const times = [0, 1, 2, 3, 4].map((i) => new Date(base + i * 1000));
      for (const occurredAt of times) {
        await insertOne(
          entityOf(followed(recipient, newUser(), { occurredAt })),
        );
      }

      const first = await notifications.page(recipient, { limit: 2 });
      expect(first.hasMore).toBe(true);
      expect(first.items.map((n) => n.occurredAt.getTime())).toEqual([
        times[4].getTime(),
        times[3].getTime(),
      ]);

      const second = await notifications.page(recipient, {
        limit: 2,
        before: { occurredAt: first.items[1].occurredAt },
      });
      expect(second.hasMore).toBe(true);
      expect(second.items.map((n) => n.occurredAt.getTime())).toEqual([
        times[2].getTime(),
        times[1].getTime(),
      ]);

      const last = await notifications.page(recipient, {
        limit: 2,
        before: { occurredAt: second.items[1].occurredAt },
      });
      expect(last.hasMore).toBe(false);
      expect(last.items.map((n) => n.occurredAt.getTime())).toEqual([
        times[0].getTime(),
      ]);

      const exact = await notifications.page(recipient, { limit: 5 });
      expect(exact).toMatchObject({ hasMore: false });
      expect(exact.items).toHaveLength(5);

      expect((await notifications.page(newUser(), { limit: 5 })).items).toEqual(
        [],
      );
    });

    it('page keysets on (occurredAt, id): rows sharing occurredAt are neither skipped nor repeated', async () => {
      const recipient = newUser();
      const tied = new Date(Date.now() - 3_000_000);
      const older = new Date(tied.getTime() - 1000);
      for (const occurredAt of [tied, tied, tied, tied, older]) {
        await insertOne(
          entityOf(followed(recipient, newUser(), { occurredAt })),
        );
      }
      const expected = (await notifications.page(recipient, { limit: 50 }))
        .items;
      expect(expected).toHaveLength(5);

      for (const limit of [1, 2]) {
        const seen: string[] = [];
        let before: { occurredAt: Date; id: string } | undefined;
        for (;;) {
          const page = await notifications.page(recipient, { limit, before });
          seen.push(...page.items.map((n) => n.id));
          if (!page.hasMore) break;
          const last = page.items[page.items.length - 1];
          before = { occurredAt: last.occurredAt, id: last.id };
        }
        expect(seen).toEqual(expected.map((n) => n.id));
      }
    });

    it('unseenCount and markSeenUpTo are scoped to the recipient and to occurredAt <= upTo', async () => {
      const a = newUser();
      const b = newUser();
      const base = Date.now() - 3_600_000;
      const times = [0, 1, 2, 3].map((i) => new Date(base + i * 1000));
      for (const occurredAt of times) {
        await insertOne(entityOf(followed(a, newUser(), { occurredAt })));
      }
      await insertOne(
        entityOf(followed(b, newUser(), { occurredAt: times[0] })),
      );

      expect(await notifications.unseenCount(a)).toBe(4);
      expect(await notifications.unseenCount(b)).toBe(1);

      // Inclusive upper bound: rows 0..2.
      expect(await notifications.markSeenUpTo(a, times[2])).toBe(3);
      expect(await notifications.unseenCount(a)).toBe(1);
      expect(await notifications.unseenCount(b)).toBe(1);

      // Already-seen rows are not changed again.
      expect(await notifications.markSeenUpTo(a, times[2])).toBe(0);
      expect(await notifications.markSeenUpTo(a, new Date())).toBe(1);
      expect(await notifications.unseenCount(a)).toBe(0);
    });
  });

  describe('ProcessedEventRepository', () => {
    it('tryInsert is idempotent, findById and markFollowUpDone work', async () => {
      const eventId = newEventId();
      const first = await notifications.runInTransaction((tx) =>
        processedEvents.tryInsert(
          ProcessedEvent.record(eventId, RoutingKeys.POST_LIKED, new Date()),
          tx,
        ),
      );
      expect(first).toBe(true);

      // A conflict neither throws nor poisons the transaction.
      const again = await notifications.runInTransaction(async (tx) => {
        const dup = await processedEvents.tryInsert(
          ProcessedEvent.record(eventId, RoutingKeys.POST_LIKED, new Date()),
          tx,
        );
        const fresh = await processedEvents.tryInsert(
          ProcessedEvent.record(
            newEventId(),
            RoutingKeys.POST_LIKED,
            new Date(),
          ),
          tx,
        );
        return { dup, fresh };
      });
      expect(again).toEqual({ dup: false, fresh: true });

      expect(await processedEvents.findById(eventId)).toMatchObject({
        eventId,
        routingKey: RoutingKeys.POST_LIKED,
        followUpDone: false,
      });
      await processedEvents.markFollowUpDone(eventId);
      expect((await processedEvents.findById(eventId))?.followUpDone).toBe(
        true,
      );
      expect(await processedEvents.findById(randomUUID())).toBeNull();
    });

    it('deleteProcessedBefore removes only rows older than the cutoff', async () => {
      const oldId = newEventId();
      const freshId = newEventId();
      await notifications.runInTransaction(async (tx) => {
        await processedEvents.tryInsert(
          ProcessedEvent.record(
            oldId,
            RoutingKeys.POST_LIKED,
            new Date('2000-01-01T00:00:00Z'),
          ),
          tx,
        );
        await processedEvents.tryInsert(
          ProcessedEvent.record(freshId, RoutingKeys.POST_LIKED, new Date()),
          tx,
        );
      });

      const removed = await processedEvents.deleteProcessedBefore(
        new Date('2000-01-02T00:00:00Z'),
      );

      expect(removed).toBeGreaterThanOrEqual(1);
      expect(await processedEvents.findById(oldId)).toBeNull();
      expect(await processedEvents.findById(freshId)).not.toBeNull();
    });
  });

  describe('EmailDeliveryRepository', () => {
    it('save inserts then updates by jobId, findByJobId returns null when missing', async () => {
      const recipient = newUser();
      const jobId = `${randomUUID()}:${recipient}`;
      jobIds.add(jobId);

      expect(await deliveries.findByJobId(jobId)).toBeNull();

      await deliveries.save(
        EmailDelivery.pending(jobId, recipient, 'POST_LIKED'),
      );
      const pending = await deliveries.findByJobId(jobId);
      expect(pending).toMatchObject({
        jobId,
        recipientId: recipient,
        kind: 'POST_LIKED',
        status: 'PENDING',
        attempts: 0,
      });

      pending!.markSent(new Date());
      await deliveries.save(pending!);

      expect(await deliveries.findByJobId(jobId)).toMatchObject({
        status: 'SENT',
        attempts: 1,
      });
      const [{ n }] = await rows<{ n: number }>(
        'SELECT count(*)::int AS n FROM email_deliveries WHERE "jobId" = $1',
        [jobId],
      );
      expect(n).toBe(1);
    });
  });

  describe('RecipientContactRepository', () => {
    it('save inserts then updates by userId, findByUserId returns null when missing', async () => {
      const userId = newUser();
      expect(await contacts.findByUserId(userId)).toBeNull();

      await contacts.save(
        RecipientContact.create(userId, 'first@e2e.test', new Date()),
      );
      const stored = await contacts.findByUserId(userId);
      expect(stored?.email).toBe('first@e2e.test');

      stored!.refresh('second@e2e.test', new Date());
      await contacts.save(stored!);

      expect((await contacts.findByUserId(userId))?.email).toBe(
        'second@e2e.test',
      );
      const [{ n }] = await rows<{ n: number }>(
        'SELECT count(*)::int AS n FROM recipient_contacts WHERE "userId" = $1',
        [userId],
      );
      expect(n).toBe(1);
    });
  });

  describe('PreferencesRepository', () => {
    it('findByUserId yields unsaved defaults when missing; save upserts', async () => {
      const userId = newUser();

      const defaults = await preferences.findByUserId(userId);
      expect(defaults).toMatchObject({
        userId,
        emailMessages: true,
        emailComments: true,
        emailLikes: true,
        emailFollows: true,
      });
      expect(
        await rows(
          'SELECT 1 FROM notification_preferences WHERE "userId" = $1',
          [userId],
        ),
      ).toHaveLength(0);

      defaults.update({ emailLikes: false });
      await preferences.save(defaults);
      expect(await preferences.findByUserId(userId)).toMatchObject({
        emailLikes: false,
        emailComments: true,
      });

      const next = await preferences.findByUserId(userId);
      next.update({ emailLikes: true, emailMessages: false });
      await preferences.save(next);
      expect(await preferences.findByUserId(userId)).toMatchObject({
        emailLikes: true,
        emailMessages: false,
      });
      const [{ n }] = await rows<{ n: number }>(
        'SELECT count(*)::int AS n FROM notification_preferences WHERE "userId" = $1',
        [userId],
      );
      expect(n).toBe(1);
    });
  });

  describe('SocialEventHandler (idempotency)', () => {
    it('replaying the same eventId creates one notification and runs follow-ups once', async () => {
      const recipient = newUser();
      const publish = jest.spyOn(bus, 'publish').mockResolvedValue();
      const enqueue = jest.spyOn(bus, 'enqueueEmail').mockResolvedValue();
      const env = commented(recipient, newUser());

      await social.handle(env);
      await social.handle(env);
      await social.handle(env);

      expect(await countFor(recipient)).toBe(1);
      expect(
        await rows('SELECT 1 FROM processed_events WHERE "eventId" = $1', [
          env.eventId,
        ]),
      ).toHaveLength(1);
      expect((await processedEvents.findById(env.eventId))?.followUpDone).toBe(
        true,
      );
      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledWith(
        RoutingKeys.NOTIFICATION_CREATED,
        expect.objectContaining({
          payload: expect.objectContaining({ recipientId: recipient }),
        }),
      );
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: `${env.eventId}:${recipient}`,
          kind: 'POST_COMMENTED',
        }),
      );
    });

    it('a replay with followUpDone=false re-runs only the follow-ups', async () => {
      const recipient = newUser();
      const publish = jest.spyOn(bus, 'publish').mockResolvedValue();
      const enqueue = jest
        .spyOn(bus, 'enqueueEmail')
        .mockRejectedValueOnce(new Error('broker down'))
        .mockResolvedValue();
      const env = followed(recipient, newUser());

      // Commit succeeded, enqueue failed: nack and retry in production.
      await expect(social.handle(env)).rejects.toThrow('broker down');
      expect(await countFor(recipient)).toBe(1);
      expect((await processedEvents.findById(env.eventId))?.followUpDone).toBe(
        false,
      );
      const createdBefore = await notifications.findBySourceEventId(
        env.eventId,
      );

      await social.handle(env);

      expect(await countFor(recipient)).toBe(1);
      const createdAfter = await notifications.findBySourceEventId(env.eventId);
      expect(createdAfter?.id).toBe(createdBefore?.id);
      expect((await processedEvents.findById(env.eventId))?.followUpDone).toBe(
        true,
      );
      // Failed attempt + re-run: publish ran twice, email enqueued twice (same jobId).
      expect(publish).toHaveBeenCalledTimes(2);
      expect(enqueue).toHaveBeenCalledTimes(2);
      expect(enqueue.mock.calls[0][0].jobId).toBe(
        enqueue.mock.calls[1][0].jobId,
      );
    });

    it('the like partial-unique conflict with a new eventId is a duplicate: one notification', async () => {
      const recipient = newUser();
      const actor = newUser();
      const postId = randomUUID();
      const publish = jest.spyOn(bus, 'publish').mockResolvedValue();
      const enqueue = jest.spyOn(bus, 'enqueueEmail').mockResolvedValue();
      const first = postLiked(recipient, actor, postId);
      const second = postLiked(recipient, actor, postId);

      await social.handle(first);
      await social.handle(second);

      expect(await countFor(recipient)).toBe(1);
      expect(
        await notifications.findBySourceEventId(second.eventId),
      ).toBeNull();
      // The duplicate is still marked processed and fully handled.
      expect(await processedEvents.findById(second.eventId)).toMatchObject({
        followUpDone: true,
      });
      expect(publish).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('a self-action stores nothing but is still marked processed', async () => {
      const user = newUser();
      const publish = jest.spyOn(bus, 'publish').mockResolvedValue();
      const enqueue = jest.spyOn(bus, 'enqueueEmail').mockResolvedValue();
      const env = followed(user, user);

      await social.handle(env);

      expect(await countFor(user)).toBe(0);
      expect(await processedEvents.findById(env.eventId)).toMatchObject({
        followUpDone: true,
      });
      expect(publish).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('preferences decide the email job, not the stored notification', async () => {
      const recipient = newUser();
      await muteEmail(recipient);
      const publish = jest.spyOn(bus, 'publish').mockResolvedValue();
      const enqueue = jest.spyOn(bus, 'enqueueEmail').mockResolvedValue();

      await social.handle(followed(recipient, newUser()));

      expect(await countFor(recipient)).toBe(1);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(enqueue).not.toHaveBeenCalled();
    });
  });

  describe('MessageAlertHandler (chat.message.alerted)', () => {
    const alerted = (recipientId: string, actorId: string) =>
      envelope(RoutingKeys.CHAT_MESSAGE_ALERTED, {
        actor: actorOf(actorId),
        recipientId,
        chatId: randomUUID(),
        messageId: randomUUID(),
        chatTitle: null,
        preview: 'hello there',
      });

    it('stores no notification; an email job is enqueued once when allowed', async () => {
      const recipient = newUser();
      const publish = jest.spyOn(bus, 'publish').mockResolvedValue();
      const enqueue = jest.spyOn(bus, 'enqueueEmail').mockResolvedValue();
      const env = alerted(recipient, newUser());

      await alerts.handle(env);
      await alerts.handle(env);

      expect(await countFor(recipient)).toBe(0);
      expect(
        await rows('SELECT 1 FROM notifications WHERE "sourceEventId" = $1', [
          env.eventId,
        ]),
      ).toHaveLength(0);
      expect(await processedEvents.findById(env.eventId)).toMatchObject({
        routingKey: RoutingKeys.CHAT_MESSAGE_ALERTED,
        followUpDone: true,
      });
      expect(publish).not.toHaveBeenCalled();
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: `${env.eventId}:${recipient}`,
          kind: 'NEW_MESSAGE',
        }),
      );
    });

    it('enqueues no email when emailMessages is off, and still stores nothing', async () => {
      const recipient = newUser();
      await muteEmail(recipient);
      const enqueue = jest.spyOn(bus, 'enqueueEmail').mockResolvedValue();
      const env = alerted(recipient, newUser());

      await alerts.handle(env);

      expect(enqueue).not.toHaveBeenCalled();
      expect(await countFor(recipient)).toBe(0);
      expect(await processedEvents.findById(env.eventId)).toMatchObject({
        followUpDone: true,
      });
    });
  });

  describe('broker round trip', () => {
    it('a social event published to innogram.events ends up as one notification, even when sent twice', async () => {
      const recipient = newUser();
      await muteEmail(recipient);
      const env = followed(recipient, newUser());

      await bus.publish(RoutingKeys.USER_FOLLOWED, env);
      // Redelivery of the same event id is a duplicate whichever consumer handles it.
      await bus.publish(RoutingKeys.USER_FOLLOWED, env);

      const stored = await pollUntil(
        () => notifications.findBySourceEventId(env.eventId),
        (n) => n !== null,
      );
      expect(stored).toMatchObject({ recipientId: recipient });

      await pollUntil(
        () => processedEvents.findById(env.eventId),
        (m) => m?.followUpDone === true,
      );
      // Give the second delivery time to be consumed and dropped.
      await sleep(500);
      expect(await countFor(recipient)).toBe(1);
    });

    it('an invalid payload never becomes a notification', async () => {
      const recipient = newUser();
      const env = envelope(RoutingKeys.USER_FOLLOWED, {
        actor: actorOf(newUser()),
        recipientId: 'not-a-uuid',
      });

      await bus.publish(RoutingKeys.USER_FOLLOWED, env);
      // Waits for the poison message to reach the DLQ and removes it again.
      const deadLettered = await removeFromDlq(env.eventId);
      await sleep(500);

      expect(deadLettered).toBe(true);
      expect(await notifications.findBySourceEventId(env.eventId)).toBeNull();
      expect(await processedEvents.findById(env.eventId)).toBeNull();
      expect(await countFor(recipient)).toBe(0);
    });
  });

  describe('HTTP API', () => {
    let a: string;
    let b: string;
    let aTimes: Date[];

    beforeAll(async () => {
      a = newUser();
      b = newUser();
      const base = Date.now() - 3_600_000;
      aTimes = [0, 1, 2].map((i) => new Date(base + i * 1000));
      for (const occurredAt of aTimes) {
        await insertOne(entityOf(followed(a, newUser(), { occurredAt })));
      }
      await insertOne(
        entityOf(
          postLiked(b, newUser(), randomUUID(), { occurredAt: aTimes[0] }),
        ),
      );
    });

    it('rejects requests without a valid token with 401', async () => {
      await http.get('/notifications').expect(401);
      await http.get('/notifications/unseen-count').expect(401);
      await http.post('/notifications/seen').send({}).expect(401);
      await http.get('/notifications/preferences').expect(401);
      await http
        .get('/notifications')
        .set({ Authorization: 'Bearer nope' })
        .expect(401);
    });

    it("GET /notifications lists only the caller's items, newest first", async () => {
      const resA = await http.get('/notifications').set(authed(a)).expect(200);
      expect(resA.body.items).toHaveLength(3);
      expect(resA.body.hasMore).toBe(false);
      expect(resA.body.unseenCount).toBe(3);
      expect(resA.body.items.map((i: any) => i.occurredAt)).toEqual(
        [...aTimes].reverse().map((d) => d.toISOString()),
      );
      expect(resA.body.items[0]).toMatchObject({
        kind: 'USER_FOLLOWED',
        seen: false,
        target: { type: 'PROFILE', postId: null },
        actor: { avatarUrl: null },
      });

      const resB = await http.get('/notifications').set(authed(b)).expect(200);
      expect(resB.body.items).toHaveLength(1);
      expect(resB.body.items[0].kind).toBe('POST_LIKED');
      expect(resB.body.items[0].id).not.toBe(resA.body.items[0].id);
    });

    it('GET /notifications paginates with limit and before', async () => {
      const page1 = await http
        .get('/notifications?limit=2')
        .set(authed(a))
        .expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.hasMore).toBe(true);

      const page2 = await http
        .get('/notifications')
        .query({ limit: 2, before: page1.body.items[1].occurredAt })
        .set(authed(a))
        .expect(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.hasMore).toBe(false);
      expect(page2.body.items[0].occurredAt).toBe(aTimes[0].toISOString());
    });

    it('GET /notifications pages ties via nextCursor without duplicates or skips', async () => {
      const c = newUser();
      const tied = new Date(Date.now() - 2_000_000);
      const times = [tied, tied, tied, new Date(tied.getTime() - 1000), tied];
      for (const occurredAt of times) {
        await insertOne(entityOf(followed(c, newUser(), { occurredAt })));
      }
      const all = await http
        .get('/notifications?limit=50')
        .set(authed(c))
        .expect(200);
      expect(all.body.nextCursor).toBeNull();
      const ids: string[] = all.body.items.map((i: any) => i.id);
      expect(new Set(ids).size).toBe(5);
      // occurredAt DESC, id DESC (Postgres orders uuids like lowercase hex strings)
      const desc = (x: string, y: string) => (x < y ? 1 : x > y ? -1 : 0);
      const sorted = [...all.body.items].sort(
        (x: any, y: any) =>
          desc(x.occurredAt, y.occurredAt) || desc(x.id, y.id),
      );
      expect(ids).toEqual(sorted.map((i: any) => i.id));

      for (const limit of [1, 2]) {
        const seen: string[] = [];
        let before: string | undefined;
        for (let guard = 0; guard < 10; guard++) {
          const res = await http
            .get('/notifications')
            .query(before ? { limit, before } : { limit })
            .set(authed(c))
            .expect(200);
          seen.push(...res.body.items.map((i: any) => i.id));
          if (!res.body.hasMore) {
            expect(res.body.nextCursor).toBeNull();
            break;
          }
          expect(typeof res.body.nextCursor).toBe('string');
          before = res.body.nextCursor;
        }
        expect(seen).toEqual(ids);
      }
    });

    it('GET /notifications rejects a malformed cursor with 400', async () => {
      for (const before of [
        'nope',
        Buffer.from('not json').toString('base64url'),
        Buffer.from(JSON.stringify(['2026-01-01T00:00:00.000Z'])).toString(
          'base64url',
        ),
        Buffer.from(
          JSON.stringify(['2026-01-01T00:00:00.000Z', 'not-a-uuid']),
        ).toString('base64url'),
      ]) {
        await http
          .get('/notifications')
          .query({ before })
          .set(authed(a))
          .expect(400);
      }
    });

    it('GET /notifications validates its query with 400', async () => {
      await http.get('/notifications?limit=51').set(authed(a)).expect(400);
      await http.get('/notifications?limit=0').set(authed(a)).expect(400);
      await http
        .get('/notifications?before=yesterday')
        .set(authed(a))
        .expect(400);
    });

    it('GET /notifications accepts the maximum page size limit=50', async () => {
      const res = await http
        .get('/notifications?limit=50')
        .set(authed(a))
        .expect(200);
      expect(res.body.items).toHaveLength(3);
      expect(res.body.hasMore).toBe(false);
    });

    it('GET /notifications/unseen-count is scoped to the caller', async () => {
      const resA = await http
        .get('/notifications/unseen-count')
        .set(authed(a))
        .expect(200);
      expect(resA.body).toEqual({ unseenCount: 3 });
      const resB = await http
        .get('/notifications/unseen-count')
        .set(authed(b))
        .expect(200);
      expect(resB.body).toEqual({ unseenCount: 1 });
      const none = await http
        .get('/notifications/unseen-count')
        .set(authed(newUser()))
        .expect(200);
      expect(none.body).toEqual({ unseenCount: 0 });
    });

    it("POST /notifications/seen marks only the caller's rows, honouring upTo", async () => {
      // Up to the middle row: marks 2 of A's 3, leaves B untouched.
      const partial = await http
        .post('/notifications/seen')
        .set(authed(a))
        .send({ upTo: aTimes[1].toISOString() })
        .expect(200);
      expect(partial.body).toEqual({ unseenCount: 1 });
      expect(
        (await http.get('/notifications/unseen-count').set(authed(b))).body,
      ).toEqual({ unseenCount: 1 });

      // B marking everything seen must not touch A's remaining row.
      const bAll = await http
        .post('/notifications/seen')
        .set(authed(b))
        .send({})
        .expect(200);
      expect(bAll.body).toEqual({ unseenCount: 0 });
      expect(
        (await http.get('/notifications/unseen-count').set(authed(a))).body,
      ).toEqual({ unseenCount: 1 });

      const list = await http.get('/notifications').set(authed(a)).expect(200);
      expect(list.body.items.map((i: any) => i.seen)).toEqual([
        false,
        true,
        true,
      ]);

      const aAll = await http
        .post('/notifications/seen')
        .set(authed(a))
        .send({})
        .expect(200);
      expect(aAll.body).toEqual({ unseenCount: 0 });
    });

    it('POST /notifications/seen rejects a malformed upTo with 400', async () => {
      await http
        .post('/notifications/seen')
        .set(authed(a))
        .send({ upTo: 'later' })
        .expect(400);
    });

    it('GET/PUT /notifications/preferences are per caller, default all on', async () => {
      const c = newUser();
      const d = newUser();
      const allOn = {
        emailMessages: true,
        emailComments: true,
        emailLikes: true,
        emailFollows: true,
      };
      expect(
        (await http.get('/notifications/preferences').set(authed(c))).body,
      ).toEqual(allOn);

      const next = { ...allOn, emailLikes: false, emailMessages: false };
      const put = await http
        .put('/notifications/preferences')
        .set(authed(c))
        .send(next)
        .expect(200);
      expect(put.body).toEqual(next);

      expect(
        (await http.get('/notifications/preferences').set(authed(c))).body,
      ).toEqual(next);
      expect(
        (await http.get('/notifications/preferences').set(authed(d))).body,
      ).toEqual(allOn);
    });

    it('PUT /notifications/preferences needs all four booleans', async () => {
      const c = newUser();
      await http
        .put('/notifications/preferences')
        .set(authed(c))
        .send({ emailMessages: true, emailComments: true, emailLikes: true })
        .expect(400);
      await http
        .put('/notifications/preferences')
        .set(authed(c))
        .send({
          emailMessages: 'yes',
          emailComments: true,
          emailLikes: true,
          emailFollows: true,
        })
        .expect(400);
      // Nothing was saved by the rejected requests.
      expect(
        await rows(
          'SELECT 1 FROM notification_preferences WHERE "userId" = $1',
          [c],
        ),
      ).toHaveLength(0);
    });
  });
});
