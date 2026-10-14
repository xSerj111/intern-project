import type { Message } from '../entities/message.entity';
import type { ChatTransaction } from './chat-repository.port';

export interface HistoryPageOptions {
  /** Only messages with `seq` below this value (older page cursor). */
  beforeSeq?: number;
  limit: number;
}

export interface ChangesPageOptions {
  afterChangeSeq: number;
  limit: number;
}

export interface IMessageRepository {
  /** Atomically increments and returns the chat's next sequence number. */
  allocateSeq(chatId: string, tx: ChatTransaction): Promise<number>;
  insert(message: Message, tx: ChatTransaction): Promise<Message>;
  findByClientMessageId(
    chatId: string,
    authorId: string,
    clientMessageId: string,
  ): Promise<Message | null>;
  findById(messageId: string): Promise<Message | null>;
  /**
   * Loads a message of `chatId` with `seq > joinedSeq`, including soft-deleted
   * tombstones, with `attachmentIds` filled from its `message_assets` rows.
   * Null when missing, in another chat, or not visible to the caller.
   */
  findVisibleById(
    chatId: string,
    messageId: string,
    joinedSeq: number,
    tx: ChatTransaction,
  ): Promise<Message | null>;
  /**
   * Narrow write of `content`, `editedAt`, `changeSeq` and `deletedAt` (never a
   * cascading save). When the message is deleted its `message_assets` rows are
   * removed in the same transaction.
   */
  update(message: Message, tx: ChatTransaction): Promise<Message>;
  /** Newest first, only `seq > joinedSeq`; callers fetch `limit + 1` to detect more. */
  pageHistory(
    chatId: string,
    joinedSeq: number,
    options: HistoryPageOptions,
  ): Promise<Message[]>;
  /** Ordered by `changeSeq ASC`, only `seq > joinedSeq`. */
  pageChanges(
    chatId: string,
    joinedSeq: number,
    options: ChangesPageOptions,
  ): Promise<Message[]>;
  findLatestVisible(chatId: string, joinedSeq: number): Promise<Message | null>;
}

export const MESSAGE_REPOSITORY = Symbol.for('IMessageRepository');
