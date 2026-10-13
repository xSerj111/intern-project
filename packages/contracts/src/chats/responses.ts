// Legacy message response, still imported by core's MessageResponseDto.
export interface IMessageResponse {
  id: string;
  chatId: string;
  authorId: string;
  content: string;
  createdAt: string; // In JSON we sent date in ISO
}

export type ChatType = 'DIRECT' | 'GROUP';
export type ParticipantRole = 'ADMIN' | 'MEMBER';

/** Profile snapshot, resolved from user_profiles. */
export interface IChatUser {
  userId: string; // auth user id (JWT sub)
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface IChatParticipant extends IChatUser {
  role: ParticipantRole;
  joinedAt: string;
}

export interface IAttachment {
  id: string; // asset id
  mimeType: string;
  size: number; // bytes
  originalName: string;
  displayOrder: number;
  url: string; // presigned GET, short-lived
  urlExpiresAt: string;
  kind: 'image' | 'video' | 'file';
}

export type SystemEventType =
  | 'group_created'
  | 'member_added'
  | 'member_removed'
  | 'member_left'
  | 'admin_promoted'
  | 'group_renamed';

export interface IMessage {
  id: string;
  chatId: string;
  authorId: string;
  kind: 'USER' | 'SYSTEM';
  seq: number; // display order
  changeSeq: number; // catch-up cursor
  clientMessageId: string | null;
  content: string | null; // null when deleted or attachment-only
  attachments: IAttachment[]; // [] when deleted
  systemEvent: {
    type: SystemEventType;
    actorId: string;
    targetUserIds?: string[];
    title?: string;
  } | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface IConversationSummary {
  id: string;
  type: ChatType;
  title: string | null; // group name; null for DIRECT
  counterpart: IChatUser | null; // DIRECT only
  memberCount: number;
  lastMessage: IMessage | null;
  lastActivityAt: string;
  lastChangeSeq: number;
  unreadCount: number;
  myRole: ParticipantRole;
}

export interface IConversationDetail extends IConversationSummary {
  participants: IChatParticipant[]; // active only
}

export interface ICursorPage<T> {
  items: T[];
  hasMore: boolean;
}

export interface IReadState {
  chatId: string;
  lastReadSeq: number;
  unreadCount: number;
}

export interface IUploadedAttachment {
  id: string;
  mimeType: string;
  size: number;
  originalName: string;
}

export interface IAttachmentUrl {
  url: string;
  expiresAt: string;
}
