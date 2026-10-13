import type { IChatUser } from '@repo/contracts';
import { Chat, ChatType } from '../domain/entities/chat.entity';
import { ChatParticipant } from '../domain/entities/chat-participant.entity';
import { Message } from '../domain/entities/message.entity';
import type { ChatSummary } from '../domain/interfaces/chat-repository.port';
import {
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

export function toMessageResponse(message: Message): MessageResponseDto {
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
    attachments: [],
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
    lastMessage: s.lastMessage ? toMessageResponse(s.lastMessage) : null,
    lastActivityAt: chat.lastActivityAt.toISOString(),
    lastChangeSeq: Number(chat.lastSeq),
    unreadCount: s.unreadCount,
    myRole: s.myRole,
  };
}

export function toConversationSummary(
  summary: ChatSummary,
  users: UserMap,
): ConversationSummaryDto {
  return toSummary(summary.chat, summary, users);
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
): ConversationDetailDto {
  return {
    ...toSummary(summary.chat, summary, users),
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
