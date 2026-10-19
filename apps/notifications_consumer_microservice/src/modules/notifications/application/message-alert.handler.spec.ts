import { RoutingKeys } from '@repo/shared';
import type {
  ChatMessageAlertedPayload,
  EmailJob,
  EventEnvelope,
} from '@repo/shared';
import type { AppConfigService } from '../../../config/app-config.service';
import type { IConsumerRegistry } from '../../../common/messaging/consumer.types';
import { NotificationPreferences } from '../../preferences/domain/entities/notification-preferences.entity';
import { ProcessedEvent } from '../domain/entities/processed-event.entity';
import { MessageAlertHandler } from './message-alert.handler';

const EVENT_ID = '0b9a1c3e-5d1f-4c8e-9a7b-1f2e3d4c5b6a';
const RECIPIENT_ID = '11111111-1111-4111-8111-111111111111';
const CHAT_ID = '22222222-2222-4222-8222-222222222222';

function envelope(
  overrides: Partial<ChatMessageAlertedPayload> = {},
): EventEnvelope<ChatMessageAlertedPayload> {
  return {
    eventId: EVENT_ID,
    type: RoutingKeys.CHAT_MESSAGE_ALERTED,
    version: 1,
    occurredAt: '2026-10-14T10:00:00.000Z',
    payload: {
      actor: {
        userId: '33333333-3333-4333-8333-333333333333',
        username: 'anna',
        displayName: 'Anna',
        avatarUrl: null,
      },
      recipientId: RECIPIENT_ID,
      chatId: CHAT_ID,
      messageId: '44444444-4444-4444-8444-444444444444',
      chatTitle: null,
      preview: 'Hi there',
      ...overrides,
    },
  };
}

function setup(options: { emailMessages?: boolean; inserted?: boolean } = {}) {
  const tx = {};
  const processedEvents = {
    tryInsert: jest.fn().mockResolvedValue(options.inserted ?? true),
    findById: jest.fn(),
    markFollowUpDone: jest.fn().mockResolvedValue(undefined),
    deleteProcessedBefore: jest.fn(),
  };
  const notifications = {
    insert: jest.fn(),
    runInTransaction: jest.fn((work: (t: object) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const prefs = NotificationPreferences.defaults(RECIPIENT_ID);
  prefs.emailMessages = options.emailMessages ?? true;
  const preferences = {
    findByUserId: jest.fn().mockResolvedValue(prefs),
    save: jest.fn(),
  };
  const eventBus = {
    publish: jest.fn(),
    enqueueEmail: jest
      .fn<Promise<void>, [EmailJob]>()
      .mockResolvedValue(undefined),
  };
  const registerEventHandler = jest.fn();
  const registry: IConsumerRegistry = {
    registerEventHandler,
    registerEmailHandler: jest.fn(),
  };
  const config = { clientUrl: 'http://localhost:3000/' } as AppConfigService;
  const handler = new MessageAlertHandler(
    registry,
    processedEvents,
    notifications as never,
    preferences,
    eventBus,
    config,
  );
  return {
    handler,
    registerEventHandler,
    processedEvents,
    notifications,
    eventBus,
    preferences,
  };
}

describe('MessageAlertHandler', () => {
  it('registers for chat.message.alerted', () => {
    const { handler, registerEventHandler } = setup();
    handler.onModuleInit();
    expect(registerEventHandler).toHaveBeenCalledWith(
      [RoutingKeys.CHAT_MESSAGE_ALERTED],
      expect.any(Function),
      handler,
    );
  });

  it('stores no notification and enqueues a NEW_MESSAGE email job', async () => {
    const { handler, notifications, processedEvents, eventBus } = setup();

    await handler.handle(envelope());

    expect(notifications.insert).not.toHaveBeenCalled();
    expect(processedEvents.tryInsert).toHaveBeenCalledWith(
      expect.any(ProcessedEvent),
      expect.anything(),
    );
    const job = eventBus.enqueueEmail.mock.calls[0][0];
    expect(job).toEqual({
      jobId: `${EVENT_ID}:${RECIPIENT_ID}`,
      recipientId: RECIPIENT_ID,
      kind: 'NEW_MESSAGE',
      actor: envelope().payload.actor,
      link: `http://localhost:3000/messages/${CHAT_ID}`,
      summary: 'Anna sent you a message',
      excerpt: 'Hi there',
    });
    expect(job.jobId.length).toBeLessThanOrEqual(80);
    expect(processedEvents.markFollowUpDone).toHaveBeenCalledWith(EVENT_ID);
  });

  it('names the group chat in the summary', async () => {
    const { handler, eventBus } = setup();

    await handler.handle(envelope({ chatTitle: 'Team' }));

    expect(eventBus.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Anna sent a message in Team' }),
    );
  });

  it('does not enqueue when emailMessages is off', async () => {
    const { handler, eventBus, processedEvents } = setup({
      emailMessages: false,
    });

    await handler.handle(envelope());

    expect(eventBus.enqueueEmail).not.toHaveBeenCalled();
    expect(processedEvents.markFollowUpDone).toHaveBeenCalledWith(EVENT_ID);
  });

  it('acks a duplicate event whose follow-up is done without enqueuing', async () => {
    const { handler, eventBus, processedEvents } = setup({ inserted: false });
    const done = ProcessedEvent.record(
      EVENT_ID,
      RoutingKeys.CHAT_MESSAGE_ALERTED,
      new Date(),
    );
    done.markFollowUpDone();
    processedEvents.findById.mockResolvedValue(done);

    await handler.handle(envelope());

    expect(eventBus.enqueueEmail).not.toHaveBeenCalled();
    expect(processedEvents.markFollowUpDone).not.toHaveBeenCalled();
  });

  it('re-runs the follow-up for a duplicate whose enqueue had failed', async () => {
    const { handler, eventBus, processedEvents } = setup({ inserted: false });
    processedEvents.findById.mockResolvedValue(
      ProcessedEvent.record(
        EVENT_ID,
        RoutingKeys.CHAT_MESSAGE_ALERTED,
        new Date(),
      ),
    );

    await handler.handle(envelope());

    expect(eventBus.enqueueEmail).toHaveBeenCalledTimes(1);
    expect(processedEvents.markFollowUpDone).toHaveBeenCalledWith(EVENT_ID);
  });

  it('throws (retry) when the enqueue fails, leaving the follow-up open', async () => {
    const { handler, eventBus, processedEvents } = setup();
    eventBus.enqueueEmail.mockRejectedValue(new Error('broker down'));

    await expect(handler.handle(envelope())).rejects.toThrow('broker down');
    expect(processedEvents.markFollowUpDone).not.toHaveBeenCalled();
  });
});
