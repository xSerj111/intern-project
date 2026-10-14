import {
  type ActorSnapshot,
  type EventEnvelope,
  RoutingKeys,
} from '@repo/shared';
import { UnsupportedNotificationEventError } from '../errors/notification.errors';
import { Notification } from './notification.entity';

const ACTOR: ActorSnapshot = {
  userId: '11111111-1111-1111-1111-111111111111',
  username: 'anna',
  displayName: 'Anna',
  avatarUrl: null,
};
const RECIPIENT = '22222222-2222-2222-2222-222222222222';
const POST = '33333333-3333-3333-3333-333333333333';
const COMMENT = '44444444-4444-4444-4444-444444444444';
const EVENT = '55555555-5555-5555-5555-555555555555';
const OCCURRED = '2026-01-01T10:00:00.000Z';

function envelope<T>(type: string, payload: T): EventEnvelope<T> {
  return {
    eventId: EVENT,
    type,
    version: 1,
    occurredAt: OCCURRED,
    payload,
  };
}

describe('Notification', () => {
  describe('fromEvent', () => {
    it('returns null when the actor is the recipient', () => {
      const result = Notification.fromEvent(
        envelope(RoutingKeys.USER_FOLLOWED, {
          actor: ACTOR,
          recipientId: ACTOR.userId,
        }),
      );
      expect(result).toBeNull();
    });

    it('maps social.post.commented to a COMMENT target with the post id', () => {
      const n = Notification.fromEvent(
        envelope(RoutingKeys.POST_COMMENTED, {
          actor: ACTOR,
          recipientId: RECIPIENT,
          postId: POST,
          commentId: COMMENT,
          excerpt: 'nice',
        }),
      )!;
      expect(n.kind).toBe('POST_COMMENTED');
      expect(n.targetType).toBe('COMMENT');
      expect(n.targetId).toBe(COMMENT);
      expect(n.postId).toBe(POST);
      expect(n.excerpt).toBe('nice');
      expect(n.recipientId).toBe(RECIPIENT);
      expect(n.actorId).toBe(ACTOR.userId);
      expect(n.sourceEventId).toBe(EVENT);
      expect(n.occurredAt).toEqual(new Date(OCCURRED));
      expect(n.seenAt).toBeNull();
      expect(n.actorSnapshot).toEqual({
        username: 'anna',
        displayName: 'Anna',
        avatarUrl: null,
      });
    });

    it('maps social.post.liked to a POST target', () => {
      const n = Notification.fromEvent(
        envelope(RoutingKeys.POST_LIKED, {
          actor: ACTOR,
          recipientId: RECIPIENT,
          postId: POST,
          excerpt: 'hello',
        }),
      )!;
      expect(n.kind).toBe('POST_LIKED');
      expect(n.targetType).toBe('POST');
      expect(n.targetId).toBe(POST);
      expect(n.postId).toBeNull();
    });

    it('maps social.comment.liked to a COMMENT target with the post id', () => {
      const n = Notification.fromEvent(
        envelope(RoutingKeys.COMMENT_LIKED, {
          actor: ACTOR,
          recipientId: RECIPIENT,
          postId: POST,
          commentId: COMMENT,
          excerpt: 'hello',
        }),
      )!;
      expect(n.kind).toBe('COMMENT_LIKED');
      expect(n.targetType).toBe('COMMENT');
      expect(n.targetId).toBe(COMMENT);
      expect(n.postId).toBe(POST);
    });

    it("maps social.user.followed to a PROFILE target with the follower's id", () => {
      const n = Notification.fromEvent(
        envelope(RoutingKeys.USER_FOLLOWED, {
          actor: ACTOR,
          recipientId: RECIPIENT,
        }),
      )!;
      expect(n.kind).toBe('USER_FOLLOWED');
      expect(n.targetType).toBe('PROFILE');
      expect(n.targetId).toBe(ACTOR.userId);
      expect(n.postId).toBeNull();
      expect(n.excerpt).toBeNull();
    });

    it('trims the excerpt to 140 characters', () => {
      const n = Notification.fromEvent(
        envelope(RoutingKeys.POST_LIKED, {
          actor: ACTOR,
          recipientId: RECIPIENT,
          postId: POST,
          excerpt: 'x'.repeat(300),
        }),
      )!;
      expect(n.excerpt).toHaveLength(140);
    });

    it('rejects events that are not stored as notifications', () => {
      expect(() =>
        Notification.fromEvent(
          envelope(RoutingKeys.CHAT_MESSAGE_ALERTED, {
            actor: ACTOR,
            recipientId: RECIPIENT,
          }),
        ),
      ).toThrow(UnsupportedNotificationEventError);
    });
  });

  describe('markSeen', () => {
    const build = () =>
      Notification.fromEvent(
        envelope(RoutingKeys.USER_FOLLOWED, {
          actor: ACTOR,
          recipientId: RECIPIENT,
        }),
      )!;

    it('sets seenAt once and never moves it', () => {
      const n = build();
      const first = new Date('2026-01-02T00:00:00.000Z');
      const later = new Date('2026-01-03T00:00:00.000Z');

      expect(n.markSeen(first)).toBe(true);
      expect(n.seenAt).toEqual(first);
      expect(n.markSeen(later)).toBe(false);
      expect(n.seenAt).toEqual(first);
    });
  });

  describe('toSnapshot', () => {
    it('builds the wire snapshot', () => {
      const n = Notification.fromEvent(
        envelope(RoutingKeys.COMMENT_LIKED, {
          actor: ACTOR,
          recipientId: RECIPIENT,
          postId: POST,
          commentId: COMMENT,
          excerpt: 'hey',
        }),
      )!;
      expect(n.toSnapshot()).toEqual({
        id: n.id,
        kind: 'COMMENT_LIKED',
        actor: {
          userId: ACTOR.userId,
          username: 'anna',
          displayName: 'Anna',
          avatarUrl: null,
        },
        target: { type: 'COMMENT', id: COMMENT, postId: POST },
        excerpt: 'hey',
        occurredAt: OCCURRED,
        seen: false,
      });
    });
  });
});
