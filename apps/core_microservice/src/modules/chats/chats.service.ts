import { Inject, Injectable } from '@nestjs/common';
import type {
  ICursorPage,
  IReadState,
  IConversationSummary,
} from '@repo/contracts';
import {
  LoggerKey,
  UniqueConstraintViolationError,
  type Logger,
} from '@repo/shared';
import { Chat } from './domain/entities/chat.entity';
import { ChatNotFoundError } from './domain/errors/chat.errors';
import {
  CHAT_REALTIME_PORT,
  type IChatRealtimePort,
} from './domain/interfaces/chat-realtime.port';
import {
  CHAT_REPOSITORY,
  type ChatSummary,
  type IChatRepository,
} from './domain/interfaces/chat-repository.port';
import {
  collectUserIds,
  toConversationDetail,
  toConversationSummary,
} from './dto/chat-response.mapper';
import type { ListChatsQueryDto } from './dto/list-chats-query.dto';
import type { ConversationDetailDto } from './dto/message-response.dto';
import {
  USER_DIRECTORY_PORT,
  type IUserDirectoryPort,
} from '../profiles/domain/interfaces/user-directory.port';

export interface CreateDirectResult {
  /** True when a new chat was created (HTTP 201), false for an existing pair (200). */
  created: boolean;
  chat: ConversationDetailDto;
}

@Injectable()
export class ChatsService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @Inject(CHAT_REPOSITORY) private readonly chats: IChatRepository,
    @Inject(USER_DIRECTORY_PORT)
    private readonly userDirectory: IUserDirectoryPort,
    @Inject(CHAT_REALTIME_PORT) private readonly realtime: IChatRealtimePort,
  ) {}

  async createDirect(
    me: string,
    targetUserId: string,
  ): Promise<CreateDirectResult> {
    // Validates the pair (self-chat) and yields the direct key.
    const candidate = Chat.createDirect(me, targetUserId);
    await this.userDirectory.assertUsersExist([targetUserId]);

    const existing = await this.chats.findDirectByKey(candidate.directKey!);
    if (existing) {
      return { created: false, chat: await this.detailFor(existing, me) };
    }

    let saved: Chat;
    try {
      saved = await this.chats.runInTransaction((tx) =>
        this.chats.save(candidate, tx),
      );
    } catch (err) {
      if (!(err instanceof UniqueConstraintViolationError)) throw err;
      // A concurrent request created the pair first.
      const winner = await this.chats.findDirectByKey(candidate.directKey!);
      if (!winner) throw err;
      return { created: false, chat: await this.detailFor(winner, me) };
    }

    // After commit: sockets join the room, both users get the new chat.
    const users = await this.userDirectory.getUsers([me, targetUserId]);
    for (const userId of [me, targetUserId]) {
      this.realtime.joinUserToChat(userId, saved.id);
      const conversation: IConversationSummary = toConversationSummary(
        await this.requireSummary(saved.id, userId),
        users,
      );
      this.realtime.emitToUser(userId, 'chat:upsert', { conversation });
    }
    this.logger.debug('Direct chat created', { props: { chatId: saved.id } });

    return { created: true, chat: await this.detailFor(saved, me) };
  }

  async list(
    me: string,
    query: ListChatsQueryDto,
  ): Promise<ICursorPage<IConversationSummary>> {
    const limit = query.limit;
    const rows = await this.chats.listForUser(me, {
      before: query.before ? new Date(query.before) : undefined,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const users = await this.userDirectory.getUsers(collectUserIds(page));
    return {
      items: page.map((s) => toConversationSummary(s, users)),
      hasMore,
    };
  }

  async getDetail(me: string, chatId: string): Promise<ConversationDetailDto> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw new ChatNotFoundError(chatId);
    chat.assertCanRead(me);
    return this.detailFor(chat, me);
  }

  async markRead(me: string, chatId: string, seq: number): Promise<IReadState> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw new ChatNotFoundError(chatId);
    chat.assertCanRead(me);

    const participant = chat.participantOf(me)!;
    // Validates and clamps the position; persisted atomically below.
    participant.markRead(seq, chat.lastSeq);
    const lastReadSeq = await this.chats.advanceReadSeq(
      chatId,
      me,
      participant.lastReadSeq,
    );

    const summary = await this.requireSummary(chatId, me);
    const state: IReadState = {
      chatId,
      lastReadSeq,
      unreadCount: summary.unreadCount,
    };
    this.realtime.emitToUser(me, 'chat:read', state);
    return state;
  }

  private async requireSummary(
    chatId: string,
    userId: string,
  ): Promise<ChatSummary> {
    const summary = await this.chats.getSummary(chatId, userId);
    if (!summary) throw new ChatNotFoundError(chatId);
    return summary;
  }

  private async detailFor(
    chat: Chat,
    userId: string,
  ): Promise<ConversationDetailDto> {
    const summary = await this.requireSummary(chat.id, userId);
    const users = await this.userDirectory.getUsers(collectUserIds([summary]));
    return toConversationDetail(summary, users);
  }
}
