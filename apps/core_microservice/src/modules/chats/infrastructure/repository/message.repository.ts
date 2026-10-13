import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, LessThan, MoreThan } from 'typeorm';
import type { FindOptionsWhere, Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Message } from '../../domain/entities/message.entity';
import { ChatNotFoundError } from '../../domain/errors/chat.errors';
import type { ChatTransaction } from '../../domain/interfaces/chat-repository.port';
import type {
  ChangesPageOptions,
  HistoryPageOptions,
  IMessageRepository,
} from '../../domain/interfaces/message-repository.port';
import { asTombstone, clampLimit, toPersistenceError } from './chat.repository';

export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 100;
export const CHANGES_DEFAULT_LIMIT = 200;
export const CHANGES_MAX_LIMIT = 500;

/** TypeORM adapter for the message repository port. */
@Injectable()
export class MessageRepository
  extends TypeormRepositoryBase<Message, Partial<Message>>
  implements IMessageRepository
{
  public static readonly entity = Message;
  protected relations: string[] = [];

  constructor(
    @InjectRepository(Message)
    repository: Repository<Message>,
  ) {
    super(repository);
  }

  /** Takes the chat row lock and the next value of its per-chat counter. */
  public async allocateSeq(
    chatId: string,
    tx: ChatTransaction,
  ): Promise<number> {
    // Postgres UPDATE ... RETURNING comes back as [rows, rowCount].
    const [rows] = await tx.query<[Array<{ lastSeq: string }>, number]>(
      `UPDATE chats SET "lastSeq" = "lastSeq" + 1, "lastActivityAt" = now() WHERE id = $1 RETURNING "lastSeq"`,
      [chatId],
    );
    if (!rows || rows.length === 0) throw new ChatNotFoundError(chatId);
    return Number(rows[0].lastSeq);
  }

  public async insert(message: Message, tx: ChatTransaction): Promise<Message> {
    try {
      return await tx.getRepository(Message).save(message);
    } catch (err: unknown) {
      throw toPersistenceError(err, this.tableName, this.logger);
    }
  }

  public async findByClientMessageId(
    chatId: string,
    authorId: string,
    clientMessageId: string,
  ): Promise<Message | null> {
    const message = await this.repository.findOne({
      where: { chatId, authorId, clientMessageId },
      withDeleted: true,
    });
    return message ? asTombstone(message) : null;
  }

  public async findById(messageId: string): Promise<Message | null> {
    const message = await this.repository.findOne({
      where: { id: messageId },
      withDeleted: true,
    });
    return message ? asTombstone(message) : null;
  }

  public async pageHistory(
    chatId: string,
    joinedSeq: number,
    options: HistoryPageOptions,
  ): Promise<Message[]> {
    const seq =
      options.beforeSeq !== undefined
        ? And(MoreThan(joinedSeq), LessThan(options.beforeSeq))
        : MoreThan(joinedSeq);
    const where: FindOptionsWhere<Message> = { chatId, seq };
    const messages = await this.repository.find({
      where,
      withDeleted: true,
      order: { seq: 'DESC' },
      take: clampLimit(options.limit, HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT),
    });
    return messages.map(asTombstone);
  }

  public async pageChanges(
    chatId: string,
    joinedSeq: number,
    options: ChangesPageOptions,
  ): Promise<Message[]> {
    const messages = await this.repository.find({
      where: {
        chatId,
        seq: MoreThan(joinedSeq),
        changeSeq: MoreThan(options.afterChangeSeq),
      },
      withDeleted: true,
      order: { changeSeq: 'ASC' },
      take: clampLimit(options.limit, CHANGES_DEFAULT_LIMIT, CHANGES_MAX_LIMIT),
    });
    return messages.map(asTombstone);
  }

  public async findLatestVisible(
    chatId: string,
    joinedSeq: number,
  ): Promise<Message | null> {
    const message = await this.repository.findOne({
      where: { chatId, seq: MoreThan(joinedSeq) },
      withDeleted: true,
      order: { seq: 'DESC' },
    });
    return message ? asTombstone(message) : null;
  }
}
