export type NotificationKind =
  | 'POST_COMMENTED'
  | 'POST_LIKED'
  | 'COMMENT_LIKED'
  | 'USER_FOLLOWED';

export interface INotification {
  id: string;
  kind: NotificationKind;
  actor: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  target: { type: 'POST' | 'COMMENT' | 'PROFILE'; id: string; postId: string | null };
  excerpt: string | null; // comment or post preview
  occurredAt: string;
  seen: boolean;
}

export interface INotificationPreferences {
  emailMessages: boolean;
  emailComments: boolean;
  emailLikes: boolean;
  emailFollows: boolean;
}

export interface INotificationsPage {
  items: INotification[];
  hasMore: boolean;
  unseenCount: number;
}

export interface IUnseenCount {
  unseenCount: number;
}
