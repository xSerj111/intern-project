import type { EntityManager } from 'typeorm';
import type { Chat } from '../entities/chat.entity';
import type {
  ChatParticipant,
  ParticipantRole,
} from '../entities/chat-participant.entity';
import type { Message } from '../entities/message.entity';

/** Opaque transaction handle passed between the chat and message ports. */
export type ChatTransaction = EntityManager;

export interface ListChatsOptions {
  /** `lastActivityAt` cursor: only chats with activity strictly before it. */
  before?: Date;
  limit: number;
}

/** One row of the conversation list, with the per-viewer projections. */
export interface ChatSummary {
  chat: Chat;
  unreadCount: number;
  lastMessage: Message | null;
  memberCount: number;
  /** DIRECT only: the other active participant. */
  counterpart: ChatParticipant | null;
  myRole: ChatParticipant['role'];
}

export interface IChatRepository {
  findById(chatId: string): Promise<Chat | null>;
  /** Direct chat for the unordered user pair, identified by its direct key. */
  findDirectByKey(directKey: string): Promise<Chat | null>;
  /** Active (`leftAt IS NULL`) participation of the user in the chat. */
  findActiveParticipation(
    chatId: string,
    userId: string,
  ): Promise<ChatParticipant | null>;
  listForUser(
    userId: string,
    options: ListChatsOptions,
  ): Promise<ChatSummary[]>;
  /**
   * Exact per-viewer summary of one chat (same projections as `listForUser`);
   * null when the chat is deleted or the user is not an active participant.
   */
  getSummary(
    chatId: string,
    userId: string,
    tx?: ChatTransaction,
  ): Promise<ChatSummary | null>;
  /**
   * Raises the active participant's `lastReadSeq` to `seq` (never lowers it) and
   * returns the stored value; throws `ChatNotFoundError` when not a member.
   */
  advanceReadSeq(
    chatId: string,
    userId: string,
    seq: number,
    tx?: ChatTransaction,
  ): Promise<number>;
  findActiveChatIdsForUser(userId: string): Promise<string[]>;
  /**
   * Takes the chat row lock (the one `allocateSeq` takes) and loads the chat
   * with all participant rows inside `tx`; null when missing or deleted.
   */
  findByIdForUpdate(chatId: string, tx: ChatTransaction): Promise<Chat | null>;
  /**
   * Inserts the user's row or reactivates their departed one as an active
   * MEMBER that sees messages after `joinedSeq` (`lastReadSeq` never lowered).
   */
  upsertActiveMember(
    chatId: string,
    userId: string,
    joinedSeq: number,
    tx: ChatTransaction,
  ): Promise<void>;
  /** Sets `leftAt = now()` on the user's active row. */
  markParticipantLeft(
    chatId: string,
    userId: string,
    tx: ChatTransaction,
  ): Promise<void>;
  setParticipantRole(
    chatId: string,
    userId: string,
    role: ParticipantRole,
    tx: ChatTransaction,
  ): Promise<void>;
  setTitle(chatId: string, title: string, tx: ChatTransaction): Promise<void>;
  save(chat: Chat, tx?: ChatTransaction): Promise<Chat>;
  runInTransaction<T>(work: (tx: ChatTransaction) => Promise<T>): Promise<T>;
}

export const CHAT_REPOSITORY = Symbol.for('IChatRepository');
