import {
  CommentLikedPayload,
  PostCommentedPayload,
  PostLikedPayload,
  RoutingKeys,
  UserFollowedPayload,
  type EventEnvelope,
  type RoutingKey,
} from '@repo/shared';
import type { AppConfigService } from '../../../config/app-config.service';
import {
  PoisonMessageError,
  type IConsumerRegistry,
} from '../../../common/messaging/consumer.types';
import { validatePayload } from '../../../common/messaging/message-validation';
import { NotificationPreferences } from '../../preferences/domain/entities/notification-preferences.entity';
import type { IPreferencesRepository } from '../../preferences/domain/interfaces/preferences-repository.port';
import type {
  Notification,
  SocialEventPayload,
} from '../domain/entities/notification.entity';
import { ProcessedEvent } from '../domain/entities/processed-event.entity';
import type { IEventBus } from '../domain/interfaces/event-bus.port';
import type { INotificationRepository } from '../domain/interfaces/notification-repository.port';
import type { IProcessedEventRepository } from '../domain/interfaces/processed-event-repository.port';
import { SocialEventHandler } from './social-event.handler';

const EVENT_ID = '0b9c3c62-6a43-4c3e-9a5e-6f0e1d2c3b4a';
const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const RECIPIENT_ID = '22222222-2222-4222-8222-222222222222';
const POST_ID = '33333333-3333-4333-8333-333333333333';
const COMMENT_ID = '44444444-4444-4444-8444-444444444444';
const TX = { tx: true };

const actor = {
  userId: ACTOR_ID,
  username: 'anna',
  displayName: 'Anna',
  avatarUrl: null,
};

function envelope(
  type: RoutingKey,
  payload: SocialEventPayload,
): EventEnvelope<SocialEventPayload> {
  return {
    eventId: EVENT_ID,
    type,
    version: 1,
    occurredAt: '2026-10-14T10:00:00.000Z',
    payload,
  };
}

const commented = () =>
  envelope(RoutingKeys.POST_COMMENTED, {
    actor,
    recipientId: RECIPIENT_ID,
    postId: POST_ID,
    commentId: COMMENT_ID,
    excerpt: 'Nice shot!',
  });

const postLiked = () =>
  envelope(RoutingKeys.POST_LIKED, {
    actor,
    recipientId: RECIPIENT_ID,
    postId: POST_ID,
    excerpt: 'My post',
  });

describe('SocialEventHandler', () => {
  let calls: string[];
  let m: Record<
    | 'insert'
    | 'findBySourceEventId'
    | 'unseenCount'
    | 'runInTransaction'
    | 'tryInsert'
    | 'findById'
    | 'markFollowUpDone'
    | 'findByUserId'
    | 'publish'
    | 'enqueueEmail'
    | 'registerEventHandler',
    jest.Mock
  >;
  let handler: SocialEventHandler;

  /** Resolves `result` and records `name` in call order. */
  const tracked = (mock: jest.Mock, name: string, result: unknown) =>
    mock.mockImplementation(() => {
      calls.push(name);
      return Promise.resolve(result);
    });

  const insertedNotification = () =>
    (m.insert.mock.calls as [Notification, object][])[0][0];

  beforeEach(() => {
    calls = [];
    m = {
      insert: tracked(jest.fn(), 'notification.insert', true),
      findBySourceEventId: tracked(jest.fn(), 'findBySourceEventId', null),
      unseenCount: tracked(jest.fn(), 'unseenCount', 3),
      runInTransaction: jest.fn(
        async (work: (tx: object) => Promise<unknown>) => {
          calls.push('tx.begin');
          const result = await work(TX);
          calls.push('tx.commit');
          return result;
        },
      ),
      tryInsert: tracked(jest.fn(), 'processed.tryInsert', true),
      findById: tracked(jest.fn(), 'processed.findById', null),
      markFollowUpDone: tracked(jest.fn(), 'markFollowUpDone', undefined),
      findByUserId: jest.fn((userId: string) =>
        Promise.resolve(NotificationPreferences.defaults(userId)),
      ),
      publish: tracked(jest.fn(), 'publish', undefined),
      enqueueEmail: tracked(jest.fn(), 'enqueueEmail', undefined),
      registerEventHandler: jest.fn(),
    };
    const notifications = {
      insert: m.insert,
      findBySourceEventId: m.findBySourceEventId,
      page: jest.fn(),
      unseenCount: m.unseenCount,
      markSeenUpTo: jest.fn(),
      runInTransaction: m.runInTransaction,
    } as INotificationRepository;
    const processed: IProcessedEventRepository = {
      tryInsert: m.tryInsert,
      findById: m.findById,
      markFollowUpDone: m.markFollowUpDone,
      deleteProcessedBefore: jest.fn(),
    };
    const preferences: IPreferencesRepository = {
      findByUserId: m.findByUserId,
      save: jest.fn(),
    };
    const bus: IEventBus = {
      publish: m.publish,
      enqueueEmail: m.enqueueEmail,
    };
    const registry: IConsumerRegistry = {
      registerEventHandler: m.registerEventHandler,
      registerEmailHandler: jest.fn(),
    };
    const config = { clientUrl: 'https://innogram.test/' } as AppConfigService;

    handler = new SocialEventHandler(
      registry,
      notifications,
      processed,
      preferences,
      bus,
      config,
    );
  });

  it('registers one handler per social routing key with its payload class', () => {
    handler.onModuleInit();

    const registered = m.registerEventHandler.mock.calls.map(
      ([keys, type, h]: unknown[]) => [keys, type, h === handler],
    );
    expect(registered).toEqual([
      [[RoutingKeys.POST_COMMENTED], PostCommentedPayload, true],
      [[RoutingKeys.POST_LIKED], PostLikedPayload, true],
      [[RoutingKeys.COMMENT_LIKED], CommentLikedPayload, true],
      [[RoutingKeys.USER_FOLLOWED], UserFollowedPayload, true],
    ]);
  });

  it('stores marker and notification in one transaction, then publishes, emails and marks the follow-up done', async () => {
    await handler.handle(commented());

    expect(calls).toEqual([
      'tx.begin',
      'processed.tryInsert',
      'notification.insert',
      'tx.commit',
      'unseenCount',
      'publish',
      'enqueueEmail',
      'markFollowUpDone',
    ]);
    expect(m.tryInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        routingKey: RoutingKeys.POST_COMMENTED,
        followUpDone: false,
      }),
      TX,
    );
    const stored = insertedNotification();
    expect(m.insert).toHaveBeenCalledWith(stored, TX);
    expect(stored).toMatchObject({
      recipientId: RECIPIENT_ID,
      kind: 'POST_COMMENTED',
      sourceEventId: EVENT_ID,
    });

    const [routingKey, published] = m.publish.mock.calls[0] as unknown[];
    expect(routingKey).toBe(RoutingKeys.NOTIFICATION_CREATED);
    expect(published).toMatchObject({
      type: RoutingKeys.NOTIFICATION_CREATED,
      version: 1,
      payload: {
        recipientId: RECIPIENT_ID,
        notification: stored.toSnapshot(),
        unseenCount: 3,
      },
    });
    expect(m.unseenCount).toHaveBeenCalledWith(RECIPIENT_ID);

    expect(m.enqueueEmail).toHaveBeenCalledWith({
      jobId: `${EVENT_ID}:${RECIPIENT_ID}`,
      recipientId: RECIPIENT_ID,
      kind: 'POST_COMMENTED',
      actor,
      link: `https://innogram.test/posts/${POST_ID}`,
      summary: 'Anna commented on your post',
      excerpt: 'Nice shot!',
    });
    expect(m.markFollowUpDone).toHaveBeenCalledWith(EVENT_ID);
  });

  it('links a follow email to the actor profile', async () => {
    await handler.handle(
      envelope(RoutingKeys.USER_FOLLOWED, {
        actor,
        recipientId: RECIPIENT_ID,
      }),
    );

    expect(m.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'USER_FOLLOWED',
        link: `https://innogram.test/profile/${ACTOR_ID}`,
        summary: 'Anna started following you',
        excerpt: null,
      }),
    );
  });

  it('acks a replayed event whose follow-up is done without doing anything', async () => {
    m.tryInsert.mockResolvedValue(false);
    const marker = ProcessedEvent.record(
      EVENT_ID,
      RoutingKeys.POST_LIKED,
      new Date(),
    );
    marker.markFollowUpDone();
    m.findById.mockResolvedValue(marker);

    await expect(handler.handle(postLiked())).resolves.toBeUndefined();

    expect(m.insert).not.toHaveBeenCalled();
    expect(m.findBySourceEventId).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.enqueueEmail).not.toHaveBeenCalled();
    expect(m.markFollowUpDone).not.toHaveBeenCalled();
  });

  it('re-runs only the publish and email steps when a replayed follow-up is pending', async () => {
    // First delivery committed, then publishing failed.
    m.publish.mockRejectedValueOnce(new Error('broker down'));
    await expect(handler.handle(postLiked())).rejects.toThrow('broker down');
    const stored = insertedNotification();
    expect(m.markFollowUpDone).not.toHaveBeenCalled();

    // Redelivery: the marker exists with followUpDone = false.
    tracked(m.tryInsert, 'processed.tryInsert', false);
    tracked(
      m.findById,
      'processed.findById',
      ProcessedEvent.record(EVENT_ID, RoutingKeys.POST_LIKED, new Date()),
    );
    tracked(m.findBySourceEventId, 'findBySourceEventId', stored);
    calls = [];

    await handler.handle(postLiked());

    expect(m.insert).toHaveBeenCalledTimes(1);
    expect(m.findBySourceEventId).toHaveBeenCalledWith(EVENT_ID);
    expect(calls).toEqual([
      'tx.begin',
      'processed.tryInsert',
      'tx.commit',
      'processed.findById',
      'findBySourceEventId',
      'unseenCount',
      'publish',
      'enqueueEmail',
      'markFollowUpDone',
    ]);
    expect(m.enqueueEmail).toHaveBeenCalledTimes(1);
    expect(m.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: `${EVENT_ID}:${RECIPIENT_ID}` }),
    );
  });

  it('treats a like partial-unique conflict as a duplicate', async () => {
    m.insert.mockResolvedValue(false);

    await handler.handle(postLiked());

    expect(m.tryInsert).toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.enqueueEmail).not.toHaveBeenCalled();
    expect(m.markFollowUpDone).toHaveBeenCalledWith(EVENT_ID);
  });

  it('stores nothing and sends nothing for a self-action', async () => {
    await handler.handle(
      envelope(RoutingKeys.POST_LIKED, {
        actor,
        recipientId: ACTOR_ID,
        postId: POST_ID,
        excerpt: 'Mine',
      }),
    );

    expect(m.tryInsert).toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.enqueueEmail).not.toHaveBeenCalled();
  });

  it('publishes but enqueues no email when the recipient turned the kind off', async () => {
    const prefs = NotificationPreferences.defaults(RECIPIENT_ID);
    prefs.update({ emailLikes: false });
    m.findByUserId.mockResolvedValue(prefs);

    await handler.handle(postLiked());

    expect(m.findByUserId).toHaveBeenCalledWith(RECIPIENT_ID);
    expect(m.publish).toHaveBeenCalledTimes(1);
    expect(m.enqueueEmail).not.toHaveBeenCalled();
    expect(m.markFollowUpDone).toHaveBeenCalledWith(EVENT_ID);
  });

  it('does not ack (throws) when the transaction fails, so the event is retried', async () => {
    m.insert.mockRejectedValue(new Error('db down'));

    await expect(handler.handle(commented())).rejects.toThrow('db down');
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.markFollowUpDone).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload to the DLQ', async () => {
    handler.onModuleInit();
    const [, payloadType] = m.registerEventHandler.mock.calls[0] as [
      unknown,
      new () => object,
    ];
    const invalid: EventEnvelope<object> = {
      ...commented(),
      payload: { actor, recipientId: 'not-a-uuid', postId: POST_ID },
    };

    await expect(validatePayload(invalid, payloadType)).rejects.toBeInstanceOf(
      PoisonMessageError,
    );
  });

  it('sends an unsupported event type straight to the DLQ', async () => {
    const chat = envelope(
      RoutingKeys.CHAT_MESSAGE_ALERTED,
      postLiked().payload,
    );

    await expect(handler.handle(chat)).rejects.toBeInstanceOf(
      PoisonMessageError,
    );
    expect(m.publish).not.toHaveBeenCalled();
  });
});
