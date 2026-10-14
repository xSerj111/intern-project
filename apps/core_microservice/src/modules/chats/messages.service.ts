import { Inject, Injectable } from '@nestjs/common';
import 'multer';
import type {
  IAttachmentUrl,
  ICursorPage,
  IUploadedAttachment,
} from '@repo/contracts';
import {
  LoggerKey,
  UniqueConstraintViolationError,
  type Logger,
} from '@repo/shared';
import type { Chat } from './domain/entities/chat.entity';
import type { ChatParticipant } from './domain/entities/chat-participant.entity';
import {
  Message,
  type AttachmentCandidate,
  type MessageAttachmentFile,
} from './domain/entities/message.entity';
import {
  ChatNotFoundError,
  InvalidAttachmentError,
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
import {
  ATTACHMENT_STORAGE_PORT,
  type IAttachmentStoragePort,
  type PresignedAttachmentUrl,
  type StoredAttachment,
} from './domain/interfaces/attachment-storage.port';
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
    @Inject(ATTACHMENT_STORAGE_PORT)
    private readonly storage: IAttachmentStoragePort,
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

    const attachmentIds = dto.attachmentIds ?? [];
    let message: Message;
    try {
      message = await this.chats.runInTransaction(async (tx) => {
        chat.assertCanPost(me);
        const assets = await this.loadAttachmentAssets(attachmentIds, tx);
        const candidates = await this.toCandidates(attachmentIds, assets, tx);
        const seq = await this.messages.allocateSeq(chatId, tx);
        // Eligibility is decided by the domain; the unique assetId index is
        // the backstop for a concurrent send of the same asset.
        const inserted = await this.messages.insert(
          Message.create({
            chatId,
            authorId: me,
            content: dto.content,
            attachments: candidates,
            clientMessageId: dto.clientMessageId,
            seq,
          }),
          tx,
        );
        await this.linkAttachments(inserted, assets, tx);
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

    const [response] = await this.toResponses([message]);
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

    const [response] = await this.toResponses([message]);
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
    const { changeSeq, storageKeys } = await this.chats.runInTransaction(
      async (tx) => {
        const found = await this.loadOwnVisible(me, chatId, messageId, tx);
        const assetIds = [...found.attachmentIds];
        const seq = await this.messages.allocateSeq(chatId, tx);
        found.delete(me, seq);
        await this.messages.update(found, tx);
        const keys = await this.onMessageDeleted(
          chatId,
          messageId,
          assetIds,
          tx,
        );
        return { changeSeq: seq, storageKeys: keys };
      },
    );

    this.logger.debug('Message deleted', {
      props: { chatId, messageId, changeSeq },
    });
    this.emitToChat(chatId, 'message:deleted', {
      chatId,
      messageId,
      changeSeq,
    });
    await this.deleteStoredObjects(chatId, messageId, storageKeys);
  }

  /**
   * Runs inside the delete transaction after the message's `message_assets`
   * rows are gone: soft-deletes the assets that were attached and returns
   * their storage keys for the post-commit object delete (FR-023).
   */
  async onMessageDeleted(
    chatId: string,
    messageId: string,
    assetIds: string[],
    tx: ChatTransaction,
  ): Promise<string[]> {
    if (assetIds.length === 0) return [];
    const assets = await this.storage.findAssets(assetIds, tx);
    await this.storage.softDeleteAssets(assetIds, tx);
    this.logger.debug('Message attachments soft-deleted', {
      props: { chatId, messageId, count: assetIds.length },
    });
    return assets.flatMap((a) => (a.storageKey ? [a.storageKey] : []));
  }

  /** Stores an uploaded file as a private chat attachment (FR-025). */
  async uploadAttachment(
    me: string,
    file: Express.Multer.File,
  ): Promise<IUploadedAttachment> {
    const asset = await this.storage.upload(me, file);
    this.logger.debug('Chat attachment uploaded', {
      props: { assetId: asset.id, uploaderId: me },
    });
    return {
      id: asset.id,
      mimeType: asset.mimeType,
      size: asset.size,
      originalName: asset.originalName ?? 'attachment',
    };
  }

  /**
   * A fresh presigned URL for one attachment (FR-026). Participation and
   * message visibility are checked again; anything the caller can't see is
   * reported as a missing message.
   */
  async attachmentUrl(
    me: string,
    chatId: string,
    messageId: string,
    assetId: string,
  ): Promise<IAttachmentUrl> {
    const participant = await this.loadParticipation(chatId, me);
    const message = await this.messages.findVisibleById(
      chatId,
      messageId,
      participant.joinedSeq,
    );
    const attachment = message?.attachmentFor(participant, assetId);
    if (!attachment) throw new MessageNotFoundError(messageId);

    const { url, expiresAt } = await this.storage.presign(attachment);
    return { url, expiresAt: expiresAt.toISOString() };
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

  private async replay(message: Message): Promise<SendMessageResult> {
    this.logger.debug('Duplicate send, returning original', {
      props: { chatId: message.chatId, messageId: message.id },
    });
    const [response] = await this.toResponses([message]);
    return { message: response, created: false };
  }

  private async loadAttachmentAssets(
    attachmentIds: string[],
    tx: ChatTransaction,
  ): Promise<Map<string, StoredAttachment>> {
    if (attachmentIds.length === 0) return new Map();
    const assets = await this.storage.findAssets(attachmentIds, tx);
    return new Map(assets.map((a) => [a.id, a]));
  }

  /** Facts about each requested asset, in request order, for `Message.create`. */
  private async toCandidates(
    attachmentIds: string[],
    assets: Map<string, StoredAttachment>,
    tx: ChatTransaction,
  ): Promise<AttachmentCandidate[]> {
    if (attachmentIds.length === 0) return [];
    const attached = new Set(
      await this.messages.findAttachedAssetIds(attachmentIds, tx),
    );
    return attachmentIds.map((assetId) => {
      const asset = assets.get(assetId);
      return {
        assetId,
        found: asset !== undefined,
        uploaderId: asset?.uploaderId ?? null,
        visibility: asset?.visibility ?? null,
        alreadyAttached: attached.has(assetId),
      };
    });
  }

  /**
   * Inserts the `message_assets` rows (display order = request order) and
   * fills the message's file metadata for the response.
   */
  private async linkAttachments(
    message: Message,
    assets: Map<string, StoredAttachment>,
    tx: ChatTransaction,
  ): Promise<void> {
    const ids = message.attachmentIds;
    if (ids.length === 0) return;
    try {
      await this.messages.insertAttachments(
        message.id,
        ids.map((assetId, displayOrder) => ({ assetId, displayOrder })),
        tx,
      );
    } catch (err: unknown) {
      if (err instanceof UniqueConstraintViolationError) {
        throw new InvalidAttachmentError(undefined, 'already attached');
      }
      throw err;
    }
    message.attachments = ids.flatMap((assetId, displayOrder) => {
      const asset = assets.get(assetId);
      return asset?.storageKey
        ? [
            {
              assetId,
              displayOrder,
              storageKey: asset.storageKey,
              mimeType: asset.mimeType,
              size: asset.size,
              originalName: asset.originalName,
            },
          ]
        : [];
    });
  }

  // Post-commit, best-effort: a leftover object only costs storage (FR-023).
  private async deleteStoredObjects(
    chatId: string,
    messageId: string,
    keys: string[],
  ): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.storage.deleteObjects(keys);
    } catch (err: unknown) {
      this.logger.warn('Attachment object delete failed', {
        props: {
          chatId,
          messageId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  /**
   * Maps messages to responses, presigning every attachment of the batch in
   * parallel (local signing, no network). A failed signature drops only that
   * attachment from the payload.
   */
  private async toResponses(
    messages: Message[],
  ): Promise<MessageResponseDto[]> {
    const files: MessageAttachmentFile[] = messages
      .filter((m) => m.deletedAt == null)
      .flatMap((m) => m.attachments);
    const signed = await Promise.allSettled(
      files.map((f) => this.storage.presign(f)),
    );
    const urls = new Map<string, PresignedAttachmentUrl>();
    signed.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        urls.set(files[i].assetId, result.value);
      } else {
        this.logger.warn('Attachment presign failed', {
          props: {
            assetId: files[i].assetId,
            error: String(result.reason),
          },
        });
      }
    });
    return messages.map((m) => toMessageResponse(m, urls));
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

  private async toPage(
    rows: Message[],
    limit: number,
  ): Promise<ICursorPage<MessageResponseDto>> {
    return {
      items: await this.toResponses(rows.slice(0, limit)),
      hasMore: rows.length > limit,
    };
  }
}
