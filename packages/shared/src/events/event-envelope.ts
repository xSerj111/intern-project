import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export const EXCHANGE_NAME = "innogram.events";

/** Routing keys on the `innogram.events` topic exchange (contracts/broker-events.md). */
export const RoutingKeys = {
  POST_COMMENTED: "social.post.commented",
  POST_LIKED: "social.post.liked",
  COMMENT_LIKED: "social.comment.liked",
  USER_FOLLOWED: "social.user.followed",
  CHAT_MESSAGE_ALERTED: "chat.message.alerted",
  NOTIFICATION_CREATED: "notification.created",
  NOTIFICATION_SEEN: "notification.seen",
} as const;

export type RoutingKey = (typeof RoutingKeys)[keyof typeof RoutingKeys];

export interface EventEnvelope<T> {
  /** uuid = outbox row id; consumer idempotency key */
  eventId: string;
  /** equals the routing key */
  type: string;
  version: 1;
  /** ISO timestamp */
  occurredAt: string;
  payload: T;
}

/**
 * Validated actor snapshot embedded in broker payloads. Decorators are
 * required: ValidationPipe `whitelist: true` strips undecorated properties.
 */
export class ActorSnapshot {
  @IsUUID()
  public userId!: string;

  @IsString()
  @MaxLength(100)
  public username!: string;

  @IsString()
  @MaxLength(100)
  public displayName!: string;

  @IsOptional()
  @IsString()
  public avatarUrl!: string | null;
}
