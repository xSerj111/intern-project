import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, In, LessThan, MoreThan } from 'typeorm';
import type { EntityManager, FindOptionsWhere, Repository } from 'typeorm';

import { TypeormRepositoryBase } from '@repo/shared';
import { Message } from '../../domain/entities/message.entity';
import { MessageAttachment } from '../../domain/entities/message-attachment.entity';
import { ChatNotFoundError } from '../../domain/errors/chat.errors';
import type { ChatTransaction } from '../../domain/interfaces/chat-repository.port';
import type {
  AttachmentLink,
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

  public async insertAttachments(
    messageId: string,
    links: AttachmentLink[],
    tx: ChatTransaction,
  ): Promise<void> {
    if (links.length === 0) return;
    try {
      await tx
        .getRepository(MessageAttachment)
        .insert(links.map((link) => ({ messageId, ...link })));
    } catch (err: unknown) {
      throw toPersistenceError(err, 'message_assets', this.logger);
    }
  }

  public async findAttachedAssetIds(
    assetIds: string[],
    tx: ChatTransaction,
  ): Promise<string[]> {
    if (assetIds.length === 0) return [];
    const rows = await tx.getRepository(MessageAttachment).find({
      select: { assetId: true },
      where: { assetId: In(assetIds) },
    });
    return rows.map((r) => r.assetId);
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
    if (!message) return null;
    await this.withAttachments([message]);
    return asTombstone(message);
  }

  public async findById(messageId: string): Promise<Message | null> {
    const message = await this.repository.findOne({
      where: { id: messageId },
      withDeleted: true,
    });
    return message ? asTombstone(message) : null;
  }

  public async findVisibleById(
    chatId: string,
    messageId: string,
    joinedSeq: number,
    tx?: ChatTransaction,
  ): Promise<Message | null> {
    const manager = tx ?? this.repository.manager;
    const message = await manager.getRepository(Message).findOne({
      where: { id: messageId, chatId, seq: MoreThan(joinedSeq) },
      withDeleted: true,
    });
    if (!message) return null;

    await this.withAttachments([message], manager);
    return asTombstone(message);
  }

  public async update(message: Message, tx: ChatTransaction): Promise<Message> {
    try {
      // Plain UPDATE (not softDelete/save): one statement sets the tombstone
      // columns together with the new changeSeq.
      await tx.getRepository(Message).update(
        { id: message.id },
        {
          content: message.content,
          editedAt: message.editedAt,
          changeSeq: message.changeSeq,
          deletedAt: message.deletedAt,
        },
      );
      if (message.deletedAt != null) {
        await tx
          .getRepository(MessageAttachment)
          .delete({ messageId: message.id });
      }
      return message;
    } catch (err: unknown) {
      throw toPersistenceError(err, this.tableName, this.logger);
    }
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
    await this.withAttachments(messages);
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
    await this.withAttachments(messages);
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

  /**
   * Fills `attachmentIds` and `attachments` of the live messages with one
   * query (joined with the asset rows), in display order. Deleted messages
   * have no links left.
   */
  private async withAttachments(
    messages: Message[],
    manager: EntityManager = this.repository.manager,
  ): Promise<void> {
    const live = messages.filter((m) => m.deletedAt == null);
    if (live.length === 0) return;

    const rows = await manager.getRepository(MessageAttachment).find({
      where: { messageId: In(live.map((m) => m.id)) },
      relations: { asset: true },
      order: { displayOrder: 'ASC' },
    });
    const byMessage = new Map<string, MessageAttachment[]>();
    for (const row of rows) {
      const list = byMessage.get(row.messageId) ?? [];
      list.push(row);
      byMessage.set(row.messageId, list);
    }

    for (const message of live) {
      const links = byMessage.get(message.id) ?? [];
      message.attachmentIds = links.map((l) => l.assetId);
      message.attachments = links.flatMap((l) =>
        l.asset?.storageKey
          ? [
              {
                assetId: l.assetId,
                displayOrder: l.displayOrder,
                storageKey: l.asset.storageKey,
                mimeType: l.asset.mimeType,
                size: l.asset.size,
                originalName: l.asset.originalName,
              },
            ]
          : [],
      );
    }
  }
}
