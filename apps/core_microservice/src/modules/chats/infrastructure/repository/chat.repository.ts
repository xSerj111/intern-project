import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';

import { PAGE_SIZE_MAX } from '@repo/contracts';
import {
  DatabaseQueryError,
  type Logger,
  PostgresErrorCode,
  TypeormRepositoryBase,
  UniqueConstraintViolationError,
  isTypeOrmError,
} from '@repo/shared';
import { Chat, ChatType } from '../../domain/entities/chat.entity';
import {
  ChatParticipant,
  ParticipantRole,
} from '../../domain/entities/chat-participant.entity';
import { Message } from '../../domain/entities/message.entity';
import { MessageAttachment } from '../../domain/entities/message-attachment.entity';
import { ChatNotFoundError } from '../../domain/errors/chat.errors';
import type {
  ChatSummary,
  ChatTransaction,
  IChatRepository,
  ListChatsOptions,
} from '../../domain/interfaces/chat-repository.port';

export const LIST_CHATS_DEFAULT_LIMIT = 20;
export const LIST_CHATS_MAX_LIMIT = PAGE_SIZE_MAX;

/**
 * Clamps a page size to 1..max. One extra row above `max` is allowed so callers
 * can fetch `limit + 1` to detect `hasMore`.
 */
export function clampLimit(
  limit: number,
  fallback: number,
  max: number,
): number {
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), max + 1);
}

/** Tombstones keep their seq/changeSeq but expose no content. */
export function asTombstone(message: Message): Message {
  if (message.deletedAt != null) message.content = null;
  return message;
}

/**
 * Fills `attachmentIds` and `attachments` of the live messages with one query
 * (joined with the asset rows), in display order. Deleted messages have no
 * links left.
 */
export async function loadAttachments(
  messages: Message[],
  manager: EntityManager,
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

/** Maps a TypeORM write failure to the shared database errors. */
export function toPersistenceError(
  err: unknown,
  table: string,
  logger: Logger,
): Error {
  if (
    isTypeOrmError(err) &&
    err.driverError?.code === PostgresErrorCode.UniqueViolation
  ) {
    return new UniqueConstraintViolationError(
      table,
      err.driverError.detail ?? '',
    );
  }
  logger.error(err instanceof Error ? err.message : String(err));
  return new DatabaseQueryError();
}

/** TypeORM adapter for the chat repository port. */
@Injectable()
export class ChatRepository
  extends TypeormRepositoryBase<Chat, Partial<Chat>>
  implements IChatRepository
{
  public static readonly entity = Chat;
  protected relations: string[] = ['participants'];

  constructor(
    @InjectRepository(Chat)
    repository: Repository<Chat>,
    @InjectRepository(ChatParticipant)
    private readonly participants: Repository<ChatParticipant>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {
    super(repository);
  }

  public async findById(chatId: string): Promise<Chat | null> {
    return this.repository.findOne({
      where: { id: chatId },
      relations: { participants: true },
    });
  }

  public async findDirectByKey(directKey: string): Promise<Chat | null> {
    return this.repository.findOne({
      where: { directKey, type: ChatType.DIRECT },
      relations: { participants: true },
    });
  }

  public async findActiveParticipation(
    chatId: string,
    userId: string,
  ): Promise<ChatParticipant | null> {
    return this.participants.findOne({
      where: { chatId, userId, leftAt: IsNull() },
    });
  }

  public async listForUser(
    userId: string,
    options: ListChatsOptions,
  ): Promise<ChatSummary[]> {
    return this.buildSummaries(userId, {
      before: options.before,
      limit: clampLimit(
        options.limit,
        LIST_CHATS_DEFAULT_LIMIT,
        LIST_CHATS_MAX_LIMIT,
      ),
    });
  }

  public async getSummary(
    chatId: string,
    userId: string,
    tx?: ChatTransaction,
  ): Promise<ChatSummary | null> {
    const [summary] = await this.buildSummaries(userId, { chatId }, tx);
    return summary ?? null;
  }

  /**
   * Per-viewer summaries of the user's active chats, either one page ordered by
   * `lastActivityAt DESC` or the single chat `chatId`.
   */
  private async buildSummaries(
    userId: string,
    filter: { chatId: string } | { before?: Date; limit: number },
    tx?: ChatTransaction,
  ): Promise<ChatSummary[]> {
    const manager = tx ?? this.dataSource.manager;

    // 1. The user's active memberships with per-viewer unread counts.
    const query = manager
      .getRepository(ChatParticipant)
      .createQueryBuilder('p')
      .innerJoin('p.chat', 'c')
      .select('p.chatId', 'chatId')
      .addSelect(
        `(SELECT COUNT(*) FROM messages m
          WHERE m."chatId" = p."chatId"
            AND m.seq > GREATEST(p."lastReadSeq", p."joinedSeq")
            AND m.kind = 'USER'
            AND m."authorId" <> p."userId"
            AND m."deletedAt" IS NULL)`,
        'unreadCount',
      )
      .where('p.userId = :userId', { userId })
      .andWhere('p.leftAt IS NULL')
      .andWhere('c.deletedAt IS NULL');
    if ('chatId' in filter) {
      query.andWhere('p.chatId = :chatId', { chatId: filter.chatId });
    } else {
      query
        .orderBy('c.lastActivityAt', 'DESC')
        .addOrderBy('c.id', 'DESC')
        .limit(filter.limit);
      if (filter.before) {
        query.andWhere('c.lastActivityAt < :before', { before: filter.before });
      }
    }
    const rows = await query.getRawMany<{
      chatId: string;
      unreadCount: string | number;
    }>();
    if (rows.length === 0) return [];

    const chatIds = rows.map((row) => row.chatId);

    // 2. The chats with their participants (active ones are filtered in memory).
    const chats = await manager.getRepository(Chat).find({
      where: { id: In(chatIds) },
      relations: { participants: true },
    });
    const chatsById = new Map(chats.map((chat) => [chat.id, chat]));

    // 3. The latest message each chat shows to this user (seq > joinedSeq).
    const latest = await manager
      .getRepository(Message)
      .createQueryBuilder('m')
      .withDeleted()
      .innerJoin(
        ChatParticipant,
        'p',
        'p."chatId" = m."chatId" AND p."userId" = :userId AND p."leftAt" IS NULL',
        { userId },
      )
      .where('m.chatId IN (:...chatIds)', { chatIds })
      .andWhere('m.seq > p.joinedSeq')
      .distinctOn(['m.chatId'])
      .orderBy('m.chatId')
      .addOrderBy('m.seq', 'DESC')
      .getMany();
    // One query for every preview's attachments (not one per chat).
    await loadAttachments(latest, manager);
    const latestByChat = new Map(
      latest.map((message) => [message.chatId, asTombstone(message)]),
    );

    const summaries: ChatSummary[] = [];
    for (const row of rows) {
      const chat = chatsById.get(row.chatId);
      if (!chat) continue;
      const active = chat.activeParticipants();
      const me = active.find((p) => p.userId === userId);
      if (!me) continue;
      summaries.push({
        chat,
        unreadCount: Number(row.unreadCount),
        lastMessage: latestByChat.get(chat.id) ?? null,
        memberCount: active.length,
        counterpart:
          chat.type === ChatType.DIRECT
            ? (active.find((p) => p.userId !== userId) ?? null)
            : null,
        myRole: me.role,
      });
    }
    return summaries;
  }

  /** Moves the read pointer forward only; a lower seq leaves it unchanged. */
  public async advanceReadSeq(
    chatId: string,
    userId: string,
    seq: number,
    tx?: ChatTransaction,
  ): Promise<number> {
    const manager = tx ?? this.dataSource.manager;
    // Postgres UPDATE ... RETURNING comes back as [rows, rowCount].
    const [rows] = await manager.query<
      [Array<{ lastReadSeq: string }>, number]
    >(
      `UPDATE chat_participants SET "lastReadSeq" = GREATEST("lastReadSeq", $3) WHERE "chatId" = $1 AND "userId" = $2 AND "leftAt" IS NULL RETURNING "lastReadSeq"`,
      [chatId, userId, seq],
    );
    if (!rows || rows.length === 0) throw new ChatNotFoundError(chatId);
    return Number(rows[0].lastReadSeq);
  }

  public async findActiveChatIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.participants.find({
      select: { chatId: true },
      where: { userId, leftAt: IsNull() },
    });
    return rows.map((row) => row.chatId);
  }

  public async findByIdForUpdate(
    chatId: string,
    tx: ChatTransaction,
  ): Promise<Chat | null> {
    // Lock first: FOR UPDATE can't apply to the outer-joined participants.
    const locked = await tx.query<Array<{ id: string }>>(
      `SELECT id FROM chats WHERE id = $1 AND "deletedAt" IS NULL FOR UPDATE`,
      [chatId],
    );
    if (locked.length === 0) return null;
    return tx.getRepository(Chat).findOne({
      where: { id: chatId },
      relations: { participants: true },
    });
  }

  public async upsertActiveMember(
    chatId: string,
    userId: string,
    joinedSeq: number,
    tx: ChatTransaction,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO chat_participants ("chatId", "userId", role, "joinedAt", "joinedSeq", "lastReadSeq", "leftAt")
       VALUES ($1, $2, $3, now(), $4, $4, NULL)
       ON CONFLICT ("chatId", "userId") DO UPDATE SET
         role = EXCLUDED.role,
         "joinedAt" = EXCLUDED."joinedAt",
         "joinedSeq" = EXCLUDED."joinedSeq",
         "lastReadSeq" = GREATEST(chat_participants."lastReadSeq", EXCLUDED."joinedSeq"),
         "leftAt" = NULL,
         "updatedAt" = now()`,
      [chatId, userId, ParticipantRole.MEMBER, joinedSeq],
    );
  }

  public async markParticipantLeft(
    chatId: string,
    userId: string,
    tx: ChatTransaction,
  ): Promise<void> {
    await tx.query(
      `UPDATE chat_participants SET "leftAt" = now(), "updatedAt" = now() WHERE "chatId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
      [chatId, userId],
    );
  }

  public async setParticipantRole(
    chatId: string,
    userId: string,
    role: ParticipantRole,
    tx: ChatTransaction,
  ): Promise<void> {
    await tx.query(
      `UPDATE chat_participants SET role = $3, "updatedAt" = now() WHERE "chatId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
      [chatId, userId, role],
    );
  }

  public async setTitle(
    chatId: string,
    title: string,
    tx: ChatTransaction,
  ): Promise<void> {
    await tx.query(
      `UPDATE chats SET title = $2, "updatedAt" = now() WHERE id = $1`,
      [chatId, title],
    );
  }

  public override async save(chat: Chat, tx?: ChatTransaction): Promise<Chat> {
    if (!tx) return super.save(chat);
    try {
      return await tx.getRepository(Chat).save(chat);
    } catch (err: unknown) {
      throw toPersistenceError(err, this.tableName, this.logger);
    }
  }

  public async runInTransaction<T>(
    work: (tx: ChatTransaction) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
