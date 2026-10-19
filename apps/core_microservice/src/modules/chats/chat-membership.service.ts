import { Inject, Injectable } from '@nestjs/common';
import type { IChatUser } from '@repo/contracts';
import { LoggerKey, type Logger } from '@repo/shared';
import { Chat } from './domain/entities/chat.entity';
import { ParticipantRole } from './domain/entities/chat-participant.entity';
import { Message, type SystemEvent } from './domain/entities/message.entity';
import { ChatNotFoundError } from './domain/errors/chat.errors';
import {
  CHAT_REALTIME_PORT,
  type IChatRealtimePort,
} from './domain/interfaces/chat-realtime.port';
import {
  CHAT_REPOSITORY,
  type ChatSummary,
  type ChatTransaction,
  type IChatRepository,
} from './domain/interfaces/chat-repository.port';
import {
  MESSAGE_REPOSITORY,
  type IMessageRepository,
} from './domain/interfaces/message-repository.port';
import type { AddMembersDto } from './dto/add-members.dto';
import {
  collectUserIds,
  toConversationDetail,
  toConversationSummary,
  toMessageResponse,
} from './dto/chat-response.mapper';
import type { CreateGroupChatDto } from './dto/create-group-chat.dto';
import type { ConversationDetailDto } from './dto/message-response.dto';
import type { RenameGroupDto } from './dto/rename-group.dto';
import {
  USER_DIRECTORY_PORT,
  type IUserDirectoryPort,
} from '../profiles/domain/interfaces/user-directory.port';

/** Outcome of a membership transaction: the locked chat after the change. */
interface MembershipChange {
  chat: Chat;
  messages: Message[];
}

/**
 * Group membership commands (FR-009 to FR-011). Each runs in one transaction
 * under the chat row lock: the entity method decides, every system event gets
 * its own seq and system message, and state is persisted with narrow writes
 * (never a cascading chat save, which could rewind seq/read pointers).
 * Realtime events go out only after commit.
 */
@Injectable()
export class ChatMembershipService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @Inject(CHAT_REPOSITORY) private readonly chats: IChatRepository,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: IMessageRepository,
    @Inject(USER_DIRECTORY_PORT)
    private readonly userDirectory: IUserDirectoryPort,
    @Inject(CHAT_REALTIME_PORT) private readonly realtime: IChatRealtimePort,
  ) {}

  async createGroup(
    me: string,
    dto: CreateGroupChatDto,
  ): Promise<ConversationDetailDto> {
    // Validates title and size before touching the directory.
    const { chat, events } = Chat.createGroup(me, dto.title, dto.memberIds);
    await this.userDirectory.assertUsersExist(dto.memberIds);

    const { chat: saved, messages } = await this.chats.runInTransaction(
      async (tx) => {
        // Insert of a brand-new aggregate; later changes use narrow writes.
        const inserted = await this.chats.save(chat, tx);
        return {
          chat: inserted,
          messages: await this.writeEvents(inserted.id, events, tx),
        };
      },
    );

    const memberIds = saved.activeParticipants().map((p) => p.userId);
    await this.joinAndUpsert(saved.id, memberIds);
    this.broadcast(saved.id, messages);
    this.logger.debug('Group chat created', {
      props: { chatId: saved.id, members: memberIds.length },
    });
    return this.detailFor(saved.id, me);
  }

  async rename(
    me: string,
    chatId: string,
    dto: RenameGroupDto,
  ): Promise<ConversationDetailDto> {
    const change = await this.mutate(me, chatId, (chat) =>
      chat.rename(me, dto.title),
    );
    await this.afterChange(change);
    return this.detailFor(chatId, me);
  }

  async addMembers(
    me: string,
    chatId: string,
    dto: AddMembersDto,
  ): Promise<ConversationDetailDto> {
    await this.userDirectory.assertUsersExist(dto.userIds);
    const change = await this.mutate(me, chatId, (chat) =>
      chat.addMembers(me, dto.userIds),
    );

    const added = change.messages.flatMap(
      (m) => m.systemEvent?.targetUserIds ?? [],
    );
    await this.joinAndUpsert(chatId, added);
    await this.afterChange(change, added);
    return this.detailFor(chatId, me);
  }

  async removeMember(
    me: string,
    chatId: string,
    userId: string,
  ): Promise<void> {
    const change = await this.mutate(me, chatId, (chat) =>
      chat.removeMember(me, userId),
    );
    this.evict(userId, chatId, 'removed');
    await this.afterChange(change);
  }

  async promote(
    me: string,
    chatId: string,
    userId: string,
  ): Promise<ConversationDetailDto> {
    const change = await this.mutate(me, chatId, (chat) =>
      chat.promote(me, userId),
    );
    await this.afterChange(change);
    return this.detailFor(chatId, me);
  }

  async leave(me: string, chatId: string): Promise<void> {
    const change = await this.mutate(me, chatId, (chat) => chat.leave(me));
    this.evict(me, chatId, 'left');
    await this.afterChange(change);
  }

  /**
   * Locks and loads the chat inside the transaction (so `lastSeq` and the
   * participant set are current), applies the entity method and writes its
   * events. Non-participants get 404 so the chat's existence stays hidden.
   */
  private mutate(
    me: string,
    chatId: string,
    apply: (chat: Chat) => SystemEvent[],
  ): Promise<MembershipChange> {
    return this.chats.runInTransaction(async (tx) => {
      const chat = await this.chats.findByIdForUpdate(chatId, tx);
      if (!chat) throw new ChatNotFoundError(chatId);
      chat.assertCanRead(me);
      const events = apply(chat);
      return { chat, messages: await this.writeEvents(chatId, events, tx) };
    });
  }

  /** One seq, one state write and one system message per event, in order. */
  private async writeEvents(
    chatId: string,
    events: SystemEvent[],
    tx: ChatTransaction,
  ): Promise<Message[]> {
    const written: Message[] = [];
    for (const event of events) {
      const seq = await this.messages.allocateSeq(chatId, tx);
      await this.persistEvent(chatId, event, seq, tx);
      written.push(
        await this.messages.insert(
          Message.system(chatId, event.actorId, event, seq),
          tx,
        ),
      );
    }
    return written;
  }

  private async persistEvent(
    chatId: string,
    event: SystemEvent,
    seq: number,
    tx: ChatTransaction,
  ): Promise<void> {
    const targets = event.targetUserIds ?? [];
    switch (event.type) {
      case 'group_created':
        // Rows were inserted with the new chat.
        return;
      case 'member_added':
        // Joined just before member_added: they see it, not the earlier history.
        for (const userId of targets) {
          await this.chats.upsertActiveMember(chatId, userId, seq - 1, tx);
        }
        return;
      case 'member_removed':
        for (const userId of targets) {
          await this.chats.markParticipantLeft(chatId, userId, tx);
        }
        return;
      case 'member_left':
        await this.chats.markParticipantLeft(chatId, event.actorId, tx);
        return;
      case 'admin_promoted':
        for (const userId of targets) {
          await this.chats.setParticipantRole(
            chatId,
            userId,
            ParticipantRole.ADMIN,
            tx,
          );
        }
        return;
      case 'group_renamed':
        await this.chats.setTitle(chatId, event.title!, tx);
        return;
    }
  }

  /** Broadcasts the system messages, then refreshes the remaining members' lists. */
  private async afterChange(
    { chat, messages }: MembershipChange,
    alreadyUpserted: string[] = [],
  ): Promise<void> {
    if (messages.length === 0) return;
    this.broadcast(chat.id, messages);
    const skip = new Set(alreadyUpserted);
    await this.upsertFor(
      chat.id,
      chat
        .activeParticipants()
        .map((p) => p.userId)
        .filter((id) => !skip.has(id)),
    );
    this.logger.debug('Chat membership changed', {
      props: {
        chatId: chat.id,
        events: messages.map((m) => m.systemEvent?.type),
      },
    });
  }

  /** New members: each user's sockets join the room, then get `chat:upsert`. */
  private async joinAndUpsert(
    chatId: string,
    userIds: string[],
  ): Promise<void> {
    await this.upsertFor(chatId, userIds, (userId) =>
      this.safely('joinUserToChat', chatId, () =>
        this.realtime.joinUserToChat(userId, chatId),
      ),
    );
  }

  // Leaves the room before the member_removed/member_left broadcast (FR-011).
  private evict(
    userId: string,
    chatId: string,
    reason: 'removed' | 'left',
  ): void {
    this.safely('chat:removed', chatId, () => {
      this.realtime.removeUserFromChat(userId, chatId);
      this.realtime.emitToUser(userId, 'chat:removed', { chatId, reason });
    });
  }

  private broadcast(chatId: string, messages: Message[]): void {
    for (const message of messages) {
      this.safely('message:new', chatId, () =>
        this.realtime.emitToChat(chatId, 'message:new', {
          message: toMessageResponse(message),
        }),
      );
    }
  }

  /** Sends each user their own `chat:upsert`, after the optional `before` step. */
  private async upsertFor(
    chatId: string,
    userIds: string[],
    before?: (userId: string) => void,
  ): Promise<void> {
    if (userIds.length === 0) return;
    let summaries: (ChatSummary | null)[] = [];
    let users = new Map<string, IChatUser>();
    try {
      summaries = await Promise.all(
        userIds.map((id) => this.chats.getSummary(chatId, id)),
      );
      users = await this.userDirectory.getUsers(
        collectUserIds(summaries.filter((s): s is ChatSummary => s !== null)),
      );
    } catch (err: unknown) {
      this.warn('chat:upsert', chatId, err);
    }
    userIds.forEach((userId, i) => {
      before?.(userId);
      const summary = summaries[i];
      if (!summary) return;
      this.safely('chat:upsert', chatId, () =>
        this.realtime.emitToUser(userId, 'chat:upsert', {
          conversation: toConversationSummary(summary, users),
        }),
      );
    });
  }

  // Post-commit: a failed emit must not fail the command; clients catch up via HTTP.
  private safely(label: string, chatId: string, emit: () => void): void {
    try {
      emit();
    } catch (err: unknown) {
      this.warn(label, chatId, err);
    }
  }

  private warn(label: string, chatId: string, err: unknown): void {
    this.logger.warn(`${label} emit failed`, {
      props: {
        chatId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }

  private async detailFor(
    chatId: string,
    userId: string,
  ): Promise<ConversationDetailDto> {
    const summary = await this.chats.getSummary(chatId, userId);
    if (!summary) throw new ChatNotFoundError(chatId);
    const users = await this.userDirectory.getUsers(collectUserIds([summary]));
    return toConversationDetail(summary, users);
  }
}
