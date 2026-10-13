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
import { ChatNotFoundError } from './domain/errors/chat.errors';
import {
  CHAT_REPOSITORY,
  type IChatRepository,
} from './domain/interfaces/chat-repository.port';
import {
  MESSAGE_REPOSITORY,
  type IMessageRepository,
} from './domain/interfaces/message-repository.port';
import {
  CHAT_REALTIME_PORT,
  type IChatRealtimePort,
} from './domain/interfaces/chat-realtime.port';
import { toMessageResponse } from './dto/chat-response.mapper';
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
    this.emitMessageNew(chatId, response);
    // US3: emitTypingStopped(chatId, me). US6: alert recipients not viewing the chat.
    return { message: response, created: true };
  }

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

  private replay(message: Message): SendMessageResult {
    this.logger.debug('Duplicate send, returning original', {
      props: { chatId: message.chatId, messageId: message.id },
    });
    return { message: toMessageResponse(message), created: false };
  }

  // Post-commit: a failed emit must not fail the send; clients catch up via /changes.
  private emitMessageNew(chatId: string, message: MessageResponseDto): void {
    try {
      this.realtime.emitToChat(chatId, 'message:new', { message });
    } catch (err: unknown) {
      this.logger.warn('message:new emit failed', {
        props: {
          chatId,
          messageId: message.id,
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
