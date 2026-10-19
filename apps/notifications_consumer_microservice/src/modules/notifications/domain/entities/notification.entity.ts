import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import {
  EXCERPT_MAX_LENGTH,
  RoutingKeys,
  type CommentLikedPayload,
  type EventEnvelope,
  type NotificationKind,
  type NotificationSnapshot,
  type PostCommentedPayload,
  type PostLikedPayload,
  type UserFollowedPayload,
} from '@repo/shared';
import { UnsupportedNotificationEventError } from '../errors/notification.errors';

export type NotificationTargetType = 'POST' | 'COMMENT' | 'PROFILE';

export type SocialEventPayload =
  | PostCommentedPayload
  | PostLikedPayload
  | CommentLikedPayload
  | UserFollowedPayload;

/** Actor details frozen at event time (`actorSnapshot` jsonb). */
export interface StoredActorSnapshot {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * A stored in-app notification. State: UNSEEN (`seenAt` null) -> SEEN.
 *
 * Does not extend `TypeormEntityBase`: the table has no `updatedAt`/`deletedAt`
 * and the NotificationsV2 migration is the source of truth for the schema.
 */
@Entity('notifications')
@Unique('UQ_notifications_sourceEventId', ['sourceEventId'])
@Index('IDX_notifications_recipientId_occurredAt', [
  'recipientId',
  'occurredAt',
])
@Index('IDX_notifications_recipientId_unseen', ['recipientId'], {
  where: '"seenAt" IS NULL',
})
@Index(
  'UQ_notifications_recipientId_kind_actorId_targetId',
  ['recipientId', 'kind', 'actorId', 'targetId'],
  { unique: true, where: "kind IN ('POST_LIKED','COMMENT_LIKED')" },
)
export class Notification {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_notifications_id',
  })
  id!: string;

  @Column({ type: 'uuid' })
  recipientId!: string;

  @Column({ type: 'uuid' })
  actorId!: string;

  @Column({ type: 'varchar', length: 30 })
  kind!: NotificationKind;

  @Column({ type: 'varchar', length: 10 })
  targetType!: NotificationTargetType;

  /** Post, comment or (for `USER_FOLLOWED`) the follower's user id. */
  @Column({ type: 'uuid' })
  targetId!: string;

  /** Navigation context for comment targets. */
  @Column({ type: 'uuid', nullable: true })
  postId!: string | null;

  @Column({ type: 'jsonb' })
  actorSnapshot!: StoredActorSnapshot;

  @Column({ type: 'varchar', length: EXCERPT_MAX_LENGTH, nullable: true })
  excerpt!: string | null;

  /** Envelope `eventId`: idempotency backstop. */
  @Column({ type: 'uuid' })
  sourceEventId!: string;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  seenAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  /**
   * Builds the notification for a `social.*` envelope, or returns `null` for
   * self-actions (the actor is the recipient). Throws for event types that are
   * not stored as notifications.
   */
  static fromEvent(
    envelope: EventEnvelope<SocialEventPayload>,
  ): Notification | null {
    const { payload } = envelope;
    const target = Notification.resolveTarget(envelope.type, payload);

    if (payload.actor.userId === payload.recipientId) {
      return null;
    }

    const notification = new Notification();
    notification.id = randomUUID();
    notification.recipientId = payload.recipientId;
    notification.actorId = payload.actor.userId;
    notification.kind = target.kind;
    notification.targetType = target.targetType;
    notification.targetId = target.targetId;
    notification.postId = target.postId;
    notification.actorSnapshot = {
      username: payload.actor.username,
      displayName: payload.actor.displayName,
      avatarUrl: payload.actor.avatarUrl ?? null,
    };
    notification.excerpt = Notification.trimExcerpt(
      'excerpt' in payload ? payload.excerpt : null,
    );
    notification.sourceEventId = envelope.eventId;
    notification.occurredAt = new Date(envelope.occurredAt);
    notification.seenAt = null;
    return notification;
  }

  /** Marks the notification seen. `seenAt` is set once and never moves; returns whether it changed. */
  markSeen(now: Date): boolean {
    if (this.seenAt !== null) {
      return false;
    }
    this.seenAt = now;
    return true;
  }

  isSeen(): boolean {
    return this.seenAt !== null;
  }

  /** Wire shape relayed to clients (`notification.created`, REST list). */
  toSnapshot(): NotificationSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      actor: { userId: this.actorId, ...this.actorSnapshot },
      target: {
        type: this.targetType,
        id: this.targetId,
        postId: this.postId,
      },
      excerpt: this.excerpt,
      occurredAt: this.occurredAt.toISOString(),
      seen: this.seenAt !== null,
    };
  }

  private static trimExcerpt(excerpt: string | null): string | null {
    const trimmed = excerpt?.trim().slice(0, EXCERPT_MAX_LENGTH);
    return trimmed ? trimmed : null;
  }

  private static resolveTarget(
    type: string,
    payload: SocialEventPayload,
  ): {
    kind: NotificationKind;
    targetType: NotificationTargetType;
    targetId: string;
    postId: string | null;
  } {
    switch (type) {
      case RoutingKeys.POST_COMMENTED: {
        const p = payload as PostCommentedPayload;
        return {
          kind: 'POST_COMMENTED',
          targetType: 'COMMENT',
          targetId: p.commentId,
          postId: p.postId,
        };
      }
      case RoutingKeys.POST_LIKED: {
        const p = payload as PostLikedPayload;
        return {
          kind: 'POST_LIKED',
          targetType: 'POST',
          targetId: p.postId,
          postId: null,
        };
      }
      case RoutingKeys.COMMENT_LIKED: {
        const p = payload as CommentLikedPayload;
        return {
          kind: 'COMMENT_LIKED',
          targetType: 'COMMENT',
          targetId: p.commentId,
          postId: p.postId,
        };
      }
      case RoutingKeys.USER_FOLLOWED:
        return {
          kind: 'USER_FOLLOWED',
          targetType: 'PROFILE',
          targetId: payload.actor.userId,
          postId: null,
        };
      default:
        throw new UnsupportedNotificationEventError(type);
    }
  }
}
