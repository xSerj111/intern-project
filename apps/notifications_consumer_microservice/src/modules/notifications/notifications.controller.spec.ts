import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { MarkSeenDto } from './dto/mark-seen.dto';
import { encodeNotificationCursor } from './dto/notification-cursor';
import { NotificationsController } from './notifications.controller';
import type { NotificationsService } from './notifications.service';

const USER = '11111111-1111-4111-8111-111111111111';

describe('NotificationsController', () => {
  const service = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    unseenCount: jest.fn().mockResolvedValue({ unseenCount: 1 }),
    markSeen: jest.fn().mockResolvedValue({ unseenCount: 0 }),
  };
  const controller = new NotificationsController(
    service as unknown as NotificationsService,
  );

  it('is guarded by JwtAuthGuard', () => {
    expect(Reflect.getMetadata('__guards__', NotificationsController)).toEqual([
      JwtAuthGuard,
    ]);
  });

  it('scopes every call to the caller id', async () => {
    await controller.list(USER, { limit: 5 });
    await controller.unseenCount(USER);
    await controller.markSeen(USER, { upTo: '2026-01-01T00:00:00.000Z' });

    expect(service.list).toHaveBeenCalledWith(USER, { limit: 5 });
    expect(service.unseenCount).toHaveBeenCalledWith(USER);
    expect(service.markSeen).toHaveBeenCalledWith(
      USER,
      '2026-01-01T00:00:00.000Z',
    );
  });

  describe('ListNotificationsQueryDto', () => {
    const check = (plain: object) =>
      validate(plainToInstance(ListNotificationsQueryDto, plain));

    it.each([
      {},
      { limit: '50' },
      { before: '2026-01-01T10:00:00.000Z' },
      {
        before: encodeNotificationCursor({
          occurredAt: new Date('2026-01-01T10:00:00.000Z'),
          id: '22222222-2222-4222-8222-222222222222',
        }),
      },
    ])('accepts %j', async (plain) => {
      expect(await check(plain)).toHaveLength(0);
    });

    it.each([
      { limit: '0' },
      { limit: '51' },
      { limit: 'x' },
      { before: 'nope' },
      { before: Buffer.from('["x","y"]').toString('base64url') },
      { before: 42 },
    ])('rejects %j', async (plain) => {
      expect((await check(plain)).length).toBeGreaterThan(0);
    });
  });

  describe('MarkSeenDto', () => {
    it('allows an empty body and rejects a bad upTo', async () => {
      expect(await validate(plainToInstance(MarkSeenDto, {}))).toHaveLength(0);
      expect(
        (await validate(plainToInstance(MarkSeenDto, { upTo: 'x' }))).length,
      ).toBeGreaterThan(0);
    });
  });
});
