import type {
  IChatUser,
  IConversationSummary,
  IMessage,
  IReadState,
} from '../chats';
import type { INotification } from '../notifications';

export const REALTIME_NAMESPACE = '/realtime';

export interface ServerToClientEvents {
  'message:new': (payload: { message: IMessage }) => void;
  'message:updated': (payload: { message: IMessage }) => void;
  'message:deleted': (payload: {
    chatId: string;
    messageId: string;
    changeSeq: number;
    deletedAt: string; // ISO, the tombstone's deletion time
  }) => void;
  'chat:upsert': (payload: { conversation: IConversationSummary }) => void;
  'chat:removed': (payload: {
    chatId: string;
    reason: 'removed' | 'left';
  }) => void;
  'chat:read': (payload: IReadState) => void;
  'chat:alert': (payload: {
    chatId: string;
    messageId: string;
    actor: IChatUser;
    chatTitle: string | null;
    preview: string; // <= 100 chars, or "📎 Attachment"
  }) => void;
  typing: (payload: {
    chatId: string;
    user: IChatUser;
    isTyping: boolean;
  }) => void;
  'notification:new': (payload: {
    notification: INotification;
    unseenCount: number;
  }) => void;
  'notifications:seen': (payload: { unseenCount: 0 }) => void;
  'session:expired': (payload: { reason: 'expired' | 'revoked' }) => void;
}

export interface IRealtimeAckError {
  ok: false;
  error: { code: string; message: string };
}

export interface ClientToServerEvents {
  'chat:view': (
    payload: { chatId: string | null },
    ack: (res: { ok: true } | IRealtimeAckError) => void,
  ) => void;
  'typing:start': (payload: { chatId: string }) => void;
  'typing:stop': (payload: { chatId: string }) => void;
  'auth:renew': (
    payload: { token: string },
    ack: (res: { ok: true; expiresAt: string } | IRealtimeAckError) => void,
  ) => void;
}
