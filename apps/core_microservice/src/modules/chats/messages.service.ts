import { Inject, Injectable } from '@nestjs/common';
import type { ICursorPage } from '@repo/contracts';
import {
  LoggerKey,
  UniqueConstraintViolationError,
  type Logger,
} from '@repo/shared';
import type { Chat } from './domain/entities/chat.entity';
import type { ChatParticipant } from './domain/entities/chat-participant.entity';
import { Message } from './domain/entities/message.entity';
import {
  ChatNotFoundError,
  MessageNotFoundError,
} from './domain/errors/chat.errors';
import {
  CHAT_REPOSITORY,
  type ChatTransaction,
  type IChatRepository,
} from './domain/interfaces/chat-repository.port';
import {
  MESSAGE_REPOSITORY,
  type IMessageRepository,
} from './domain/interfaces/message-repository.port';
import {
  CHAT_REALTIME_PORT,
  type ChatRealtimeEvent,
  type ChatRealtimePayload,
  type IChatRealtimePort,
} from './domain/interfaces/chat-realtime.port';
import { toMessageResponse } from './dto/chat-response.mapper';
import type { EditMessageDto } from './dto/edit-message.dto';
import type { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import type { MessageChangesQueryDto } from './dto/message-changes-query.dto';
import type { MessageResponseDto } from './dto/message-response.dto';
import type { SendMessageDto } from './dto/send-message.dto';

/** Result of a send: `created: false` means an idempotent replay (HTTP 200, not 201). */
export interface SendMessageResult {
  message: MessageResponseDto;
  created: boolean;
}

@Injectable()
export class MessagesService {
  constructor(
    @Inject(LoggerKey) private readonly logger: Logger,
    @Inject(CHAT_REPOSITORY) private readonly chats: IChatRepository,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: IMessageRepository,
    @Inject(CHAT_REALTIME_PORT) private readonly realtime: IChatRealtimePort,
  ) {}

  /**
   * Sends a message (FR-015, FR-016). Idempotent per `clientMessageId`: a retry
   * returns the original message with `created: false`. Realtime events go out
   * only after the transaction commits.
   */
  async send(
    me: string,
    chatId: string,
    dto: SendMessageDto,
  ): Promise<SendMessageResult> {
    const chat = await this.loadChat(chatId);
    chat.assertCanRead(me);

    const existing = await this.messages.findByClientMessageId(
      chatId,
      me,
      dto.clientMessageId,
    );
    if (existing) return this.replay(existing);

    let message: Message;
    try {
      message = await this.chats.runInTransaction(async (tx) => {
        chat.assertCanPost(me);
        const seq = await this.messages.allocateSeq(chatId, tx);
        // US5: validate/link attachmentIds here before insert.
        const inserted = await this.messages.insert(
          Message.create({
            chatId,
            authorId: me,
            content: dto.content,
            attachmentIds: dto.attachmentIds,
            clientMessageId: dto.clientMessageId,
            seq,
          }),
          tx,
        );
        // Targeted UPDATE: a cascading chat save would rewind other
        // participants' concurrent read pointers.
        await this.chats.advanceReadSeq(chatId, me, seq, tx);
        return inserted;
      });
    } catch (err: unknown) {
      if (!(err instanceof UniqueConstraintViolationError)) throw err;
      // Postgres aborted the tx, so re-read outside it.
      const original = await this.messages.findByClientMessageId(
        chatId,
        me,
        dto.clientMessageId,
      );
      if (!original) throw err;
      return this.replay(original);
    }

    const response = toMessageResponse(message);
    this.logger.debug('Message sent', {
      props: { chatId, messageId: message.id, seq: response.seq },
    });
    this.emitToChat(chatId, 'message:new', { message: response });
    this.emitTypingStopped(chatId, me);
    // US6: alert recipients not viewing the chat.
    return { message: response, created: true };
  }

  /**
   * Edits the caller's own message (FR-024). The edit takes a fresh `changeSeq`
   * so catch-up sees it; `message:updated` goes out after the commit.
   */
  async edit(
    me: string,
    chatId: string,
    messageId: string,
    dto: EditMessageDto,
  ): Promise<MessageResponseDto> {
    const message = await this.chats.runInTransaction(async (tx) => {
      const found = await this.loadOwnVisible(me, chatId, messageId, tx);
      const changeSeq = await this.messages.allocateSeq(chatId, tx);
      found.edit(me, dto.content, changeSeq);
      return this.messages.update(found, tx);
    });

    const response = toMessageResponse(message);
    this.logger.debug('Message edited', {
      props: { chatId, messageId, changeSeq: response.changeSeq },
    });
    this.emitToChat(chatId, 'message:updated', { message: response });
    return response;
  }

  /**
   * Deletes the caller's own message, leaving a tombstone (FR-022). Takes a
   * fresh `changeSeq`; `message:deleted` goes out after the commit.
   */
  async delete(me: string, chatId: string, messageId: string): Promise<void> {
    const changeSeq = await this.chats.runInTransaction(async (tx) => {
      const found = await this.loadOwnVisible(me, chatId, messageId, tx);
      const assetIds = [...found.attachmentIds];
      const seq = await this.messages.allocateSeq(chatId, tx);
      found.delete(me, seq);
      await this.messages.update(found, tx);
      await this.onMessageDeleted(chatId, messageId, assetIds, tx);
      return seq;
    });

    this.logger.debug('Message deleted', {
      props: { chatId, messageId, changeSeq },
    });
    this.emitToChat(chatId, 'message:deleted', {
      chatId,
      messageId,
      changeSeq,
    });
  }

  /**
   * Hook point for US5: runs inside the delete transaction after the message's
   * `message_assets` rows are gone, with the asset ids that were attached.
   * Attachment cleanup (orphaned assets) attaches here.
   */
  /* eslint-disable @typescript-eslint/no-unused-vars */
  async onMessageDeleted(
    _chatId: string,
    _messageId: string,
    _assetIds: string[],
    _tx: ChatTransaction,
  ): Promise<void> {
    // No-op until attachments exist.
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */

  /** Newest-first history page, limited to what the caller can see (FR-017). */
  async history(
    me: string,
    chatId: string,
    query: ListMessagesQueryDto,
  ): Promise<ICursorPage<MessageResponseDto>> {
    const participant = await this.loadParticipation(chatId, me);
    const rows = await this.messages.pageHistory(
      chatId,
      participant.joinedSeq,
      { beforeSeq: query.beforeSeq, limit: query.limit + 1 },
    );
    return this.toPage(rows, query.limit);
  }

  /** Catch-up page ordered by `changeSeq` ASC (FR-006), from the caller's join. */
  async changes(
    me: string,
    chatId: string,
    query: MessageChangesQueryDto,
  ): Promise<ICursorPage<MessageResponseDto>> {
    const participant = await this.loadParticipation(chatId, me);
    const rows = await this.messages.pageChanges(
      chatId,
      participant.joinedSeq,
      { afterChangeSeq: query.afterChangeSeq, limit: query.limit + 1 },
    );
    return this.toPage(rows, query.limit);
  }

  private async loadChat(chatId: string): Promise<Chat> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw new ChatNotFoundError(chatId);
    return chat;
  }

  private async loadParticipation(
    chatId: string,
    me: string,
  ): Promise<ChatParticipant> {
    const chat = await this.loadChat(chatId);
    chat.assertCanRead(me);
    return chat.participantOf(me)!;
  }

  /**
   * Inside the tx: locks the chat, checks the caller is an active member and
   * loads the message they can see (tombstones included). A message from before
   * their join is reported as a missing chat; a missing one as a missing message.
   */
  private async loadOwnVisible(
    me: string,
    chatId: string,
    messageId: string,
    tx: ChatTransaction,
  ): Promise<Message> {
    const chat = await this.chats.findByIdForUpdate(chatId, tx);
    if (!chat) throw new ChatNotFoundError(chatId);
    chat.assertCanPost(me);

    const message = await this.messages.findVisibleById(
      chatId,
      messageId,
      chat.participantOf(me)!.joinedSeq,
      tx,
    );
    if (message) return message;

    const hidden = await this.messages.findById(messageId);
    if (hidden && hidden.chatId === chatId) throw new ChatNotFoundError(chatId);
    throw new MessageNotFoundError(messageId);
  }

  private replay(message: Message): SendMessageResult {
    this.logger.debug('Duplicate send, returning original', {
      props: { chatId: message.chatId, messageId: message.id },
    });
    return { message: toMessageResponse(message), created: false };
  }

  // Post-commit: a failed emit must not fail the request; clients catch up via /changes.
  private emitToChat<E extends ChatRealtimeEvent>(
    chatId: string,
    event: E,
    payload: ChatRealtimePayload<E>,
  ): void {
    try {
      this.realtime.emitToChat(chatId, event, payload);
    } catch (err: unknown) {
      this.logger.warn(`${event} emit failed`, {
        props: {
          chatId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private emitTypingStopped(chatId: string, userId: string): void {
    try {
      this.realtime.emitTypingStopped(chatId, userId);
    } catch (err: unknown) {
      this.logger.warn('typing stop emit failed', {
        props: {
          chatId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private toPage(
    rows: Message[],
    limit: number,
  ): ICursorPage<MessageResponseDto> {
    return {
      items: rows.slice(0, limit).map(toMessageResponse),
      hasMore: rows.length > limit,
    };
  }
}
