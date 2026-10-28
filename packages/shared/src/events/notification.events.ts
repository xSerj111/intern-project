import { Equals, IsInt, IsObject, IsUUID, Min } from "class-validator";

/**
 * Structural copy of `INotification` from `@repo/contracts` (shared must not
 * depend on contracts). Keep in sync with packages/contracts/src/notifications.
 */
export type NotificationKind =
  "POST_COMMENTED" | "POST_LIKED" | "COMMENT_LIKED" | "USER_FOLLOWED";

export interface NotificationSnapshot {
  id: string;
  kind: NotificationKind;
  actor: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  target: {
    type: "POST" | "COMMENT" | "PROFILE";
    id: string;
    postId: string | null;
  };
  excerpt: string | null;
  occurredAt: string;
  seen: boolean;
}

/** `notification.created`: relayed to `user:{recipientId}` as `notification:new`. */
export class NotificationCreatedPayload {
  @IsUUID()
  public recipientId!: string;

  @IsObject()
  public notification!: NotificationSnapshot;

  @IsInt()
  @Min(0)
  public unseenCount!: number;
}

/** `notification.seen`: relayed to `user:{userId}` as `notifications:seen`. */
export class NotificationSeenPayload {
  @IsUUID()
  public userId!: string;

  @Equals(0)
  public unseenCount!: 0;
}
