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
