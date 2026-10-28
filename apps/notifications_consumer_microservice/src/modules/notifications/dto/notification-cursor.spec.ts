import {
  encodeNotificationCursor,
  parseNotificationCursor,
} from './notification-cursor';

const ID = '22222222-2222-4222-8222-222222222222';
const AT = new Date('2026-01-01T10:00:00.123Z');

describe('notification cursor', () => {
  it('round-trips occurredAt and id through an opaque url-safe string', () => {
    const cursor = encodeNotificationCursor({ occurredAt: AT, id: ID });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parseNotificationCursor(cursor)).toEqual({ occurredAt: AT, id: ID });
  });

  it('still accepts a bare ISO occurredAt (legacy cursor) without an id', () => {
    expect(parseNotificationCursor('2026-01-01T10:00:00.123Z')).toEqual({
      occurredAt: AT,
    });
  });

  it.each([
    '',
    'nope',
    'yesterday',
    '2009-W53-7',
    '!!!',
    Buffer.from('not json').toString('base64url'),
    Buffer.from('[]').toString('base64url'),
    Buffer.from(JSON.stringify(['2026-01-01T10:00:00.123Z'])).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify(['2026-13-01T10:00:00.000Z', ID])).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify(['2026-01-01T10:00:00.123Z', 'x'])).toString(
      'base64url',
    ),
    Buffer.from(JSON.stringify([1, ID])).toString('base64url'),
  ])('rejects %j', (value) => {
    expect(parseNotificationCursor(value)).toBeNull();
  });
});
