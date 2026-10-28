import type { IChatUser } from '@repo/contracts';
import { Chat, ChatType } from '../domain/entities/chat.entity';
import { ChatParticipant } from '../domain/entities/chat-participant.entity';
import {
  Message,
  type MessageAttachmentFile,
} from '../domain/entities/message.entity';
import type { ChatSummary } from '../domain/interfaces/chat-repository.port';
import {
  attachmentKind,
  type IAttachmentStoragePort,
  type PresignedAttachmentUrl,
} from '../domain/interfaces/attachment-storage.port';
import {
  AttachmentDto,
  ChatParticipantDto,
  ChatUserDto,
  ConversationDetailDto,
  ConversationSummaryDto,
  MessageResponseDto,
} from './message-response.dto';

/** Profile snapshots keyed by auth user id (from `IUserDirectoryPort.getUsers`). */
export type UserMap = Map<string, IChatUser>;

/** Snapshot for a user with no profile (e.g. deleted account). */
function toUser(userId: string, users: UserMap): ChatUserDto {
  const u = users.get(userId);
  return {
    userId,
    username: u?.username ?? 'unknown',
    displayName: u?.displayName ?? 'Unknown user',
    avatarUrl: u?.avatarUrl ?? null,
  };
}

/** Presigned URLs keyed by asset id (from `IAttachmentStoragePort.presign`). */
export type AttachmentUrls = ReadonlyMap<string, PresignedAttachmentUrl>;

/**
 * Presigns every attachment of the live messages in parallel (local signing,
 * no network). A failed signature only drops that attachment; `onFail` is told
 * which one.
 */
export async function presignAttachments(
  messages: Message[],
  storage: IAttachmentStoragePort,
  onFail: (assetId: string, reason: string) => void,
): Promise<Map<string, PresignedAttachmentUrl>> {
  const files: MessageAttachmentFile[] = messages
    .filter((m) => m.deletedAt == null)
    .flatMap((m) => m.attachments);
  const signed = await Promise.allSettled(
    files.map((f) => storage.presign({ ...f, id: f.assetId })),
  );
  const urls = new Map<string, PresignedAttachmentUrl>();
  signed.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      urls.set(files[i].assetId, result.value);
    } else {
      onFail(files[i].assetId, String(result.reason));
    }
  });
  return urls;
}

/**
 * Attachments in display order; one without a presigned URL in `urls` is left
 * out (e.g. a message mapped without presigning).
 */
function toAttachments(
  message: Message,
  urls: AttachmentUrls,
): AttachmentDto[] {
  if (message.deletedAt != null) return [];
  return [...message.attachments]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .flatMap((a) => {
      const signed = urls.get(a.assetId);
      if (!signed) return [];
      return [
        {
          id: a.assetId,
          mimeType: a.mimeType,
          size: a.size,
          originalName: a.originalName ?? 'attachment',
          displayOrder: a.displayOrder,
          url: signed.url,
          urlExpiresAt: signed.expiresAt.toISOString(),
          kind: attachmentKind(a.mimeType),
        },
      ];
    });
}

export function toMessageResponse(
  message: Message,
  urls: AttachmentUrls = new Map(),
): MessageResponseDto {
  const deleted = message.deletedAt != null;
  return {
    id: message.id,
    chatId: message.chatId,
    authorId: message.authorId,
    kind: message.kind,
    seq: Number(message.seq),
    changeSeq: Number(message.changeSeq),
    clientMessageId: message.clientMessageId ?? null,
    content: deleted ? null : (message.content ?? null),
    attachments: toAttachments(message, urls),
    systemEvent: message.systemEvent ?? null,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedAt: message.deletedAt?.toISOString() ?? null,
  };
}

function toSummary(
  chat: Chat,
  s: Pick<
    ChatSummary,
    'unreadCount' | 'lastMessage' | 'memberCount' | 'counterpart' | 'myRole'
  >,
  users: UserMap,
  urls?: AttachmentUrls,
): ConversationSummaryDto {
  return {
    id: chat.id,
    type: chat.type,
    title: chat.title ?? null,
    counterpart:
      chat.type === ChatType.DIRECT && s.counterpart
        ? toUser(s.counterpart.userId, users)
        : null,
    memberCount: s.memberCount,
    lastMessage: s.lastMessage ? toMessageResponse(s.lastMessage, urls) : null,
    lastActivityAt: chat.lastActivityAt.toISOString(),
    lastChangeSeq: Number(chat.lastSeq),
    unreadCount: s.unreadCount,
    myRole: s.myRole,
  };
}

export function toConversationSummary(
  summary: ChatSummary,
  users: UserMap,
  urls?: AttachmentUrls,
): ConversationSummaryDto {
  return toSummary(summary.chat, summary, users, urls);
}

function toParticipant(p: ChatParticipant, users: UserMap): ChatParticipantDto {
  return {
    ...toUser(p.userId, users),
    role: p.role,
    joinedAt: p.joinedAt.toISOString(),
  };
}

export function toConversationDetail(
  summary: ChatSummary,
  users: UserMap,
  urls?: AttachmentUrls,
): ConversationDetailDto {
  return {
    ...toSummary(summary.chat, summary, users, urls),
    participants: summary.chat
      .activeParticipants()
      .map((p) => toParticipant(p, users)),
  };
}

/** User ids needed to resolve a summary/detail (counterpart + participants). */
export function collectUserIds(summaries: ChatSummary[]): string[] {
  const ids = new Set<string>();
  for (const s of summaries) {
    if (s.counterpart) ids.add(s.counterpart.userId);
    for (const p of s.chat.activeParticipants()) ids.add(p.userId);
  }
  return [...ids];
}
