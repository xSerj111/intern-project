import { RoutingKeys } from '@repo/shared';
import { Notification } from './domain/entities/notification.entity';
import type { IEventBus } from './domain/interfaces/event-bus.port';
import type { INotificationRepository } from './domain/interfaces/notification-repository.port';
import { NotificationsService } from './notifications.service';

const USER = '11111111-1111-4111-8111-111111111111';

function makeNotification(): Notification {
  const n = new Notification();
  n.id = '22222222-2222-4222-8222-222222222222';
  n.recipientId = USER;
  n.actorId = '33333333-3333-4333-8333-333333333333';
  n.kind = 'POST_LIKED';
  n.targetType = 'POST';
  n.targetId = '44444444-4444-4444-8444-444444444444';
  n.postId = null;
  n.actorSnapshot = { username: 'bob', displayName: 'Bob', avatarUrl: null };
  n.excerpt = null;
  n.occurredAt = new Date('2026-01-01T10:00:00.000Z');
  n.seenAt = null;
  return n;
}

describe('NotificationsService', () => {
  let repo: jest.Mocked<
    Pick<INotificationRepository, 'page' | 'unseenCount' | 'markSeenUpTo'>
  >;
  let bus: { publish: jest.Mock };
  let service: NotificationsService;

  beforeEach(() => {
    repo = {
      page: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      unseenCount: jest.fn().mockResolvedValue(3),
      markSeenUpTo: jest.fn().mockResolvedValue(2),
    };
    bus = { publish: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationsService(
      repo as unknown as INotificationRepository,
      bus as unknown as IEventBus,
    );
  });

  describe('list', () => {
    it('defaults limit to 20 and returns snapshots with unseenCount', async () => {
      repo.page.mockResolvedValue({
        items: [makeNotification()],
        hasMore: true,
      });

      const result = await service.list(USER, {});

      expect(repo.page).toHaveBeenCalledWith(USER, {
        before: undefined,
        limit: 20,
      });
      expect(result.hasMore).toBe(true);
      expect(result.unseenCount).toBe(3);
      expect(result.items[0]).toMatchObject({
        kind: 'POST_LIKED',
        seen: false,
        occurredAt: '2026-01-01T10:00:00.000Z',
      });
    });

    it('parses the before cursor into a Date', async () => {
      await service.list(USER, {
        before: '2026-01-01T10:00:00.000Z',
        limit: 5,
      });

      expect(repo.page).toHaveBeenCalledWith(USER, {
        before: new Date('2026-01-01T10:00:00.000Z'),
        limit: 5,
      });
    });
  });

  it('unseenCount returns the caller count', async () => {
    await expect(service.unseenCount(USER)).resolves.toEqual({
      unseenCount: 3,
    });
    expect(repo.unseenCount).toHaveBeenCalledWith(USER);
  });

  describe('markSeen', () => {
    it('marks up to the given instant, then publishes notification.seen', async () => {
      repo.unseenCount.mockResolvedValue(0);

      const result = await service.markSeen(USER, '2026-01-01T10:00:00.000Z');

      expect(repo.markSeenUpTo).toHaveBeenCalledWith(
        USER,
        new Date('2026-01-01T10:00:00.000Z'),
      );
      expect(result).toEqual({ unseenCount: 0 });
      expect(bus.publish).toHaveBeenCalledWith(
        RoutingKeys.NOTIFICATION_SEEN,
        expect.objectContaining({
          type: 'notification.seen',
          version: 1,
          payload: { userId: USER, unseenCount: 0 },
        }),
      );
      expect(repo.markSeenUpTo.mock.invocationCallOrder[0]).toBeLessThan(
        bus.publish.mock.invocationCallOrder[0],
      );
    });

    it('defaults upTo to now', async () => {
      const before = Date.now();
      await service.markSeen(USER);
      const [, upTo] = repo.markSeenUpTo.mock.calls[0];
      expect(upTo.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('still succeeds when publishing fails', async () => {
      bus.publish.mockRejectedValue(new Error('broker down'));

      await expect(service.markSeen(USER)).resolves.toEqual({
        unseenCount: 3,
      });
    });
  });
});
