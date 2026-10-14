import { Test, type TestingModule } from '@nestjs/testing';
import { LoggerKey, UniqueConstraintViolationError } from '@repo/shared';
import { MessagesService } from './messages.service';
import { Chat } from './domain/entities/chat.entity';
import {
  Message,
  type MessageAttachmentFile,
} from './domain/entities/message.entity';
import {
  ChatNotFoundError,
  EmptyMessageError,
  InvalidAttachmentError,
  MessageAlreadyDeletedError,
  MessageNotFoundError,
  NotMessageAuthorError,
} from './domain/errors/chat.errors';
import { CHAT_REPOSITORY } from './domain/interfaces/chat-repository.port';
import { MESSAGE_REPOSITORY } from './domain/interfaces/message-repository.port';
import { CHAT_REALTIME_PORT } from './domain/interfaces/chat-realtime.port';
import {
  ATTACHMENT_STORAGE_PORT,
  type StoredAttachment,
} from './domain/interfaces/attachment-storage.port';
import type { SendMessageDto } from './dto/send-message.dto';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const CHAT_ID = '44444444-4444-4444-8444-444444444444';
const CLIENT_ID = '55555555-5555-4555-8555-555555555555';
const ASSET_1 = '66666666-6666-4666-8666-666666666661';
const ASSET_2 = '66666666-6666-4666-8666-666666666662';
const EXPIRES = new Date('2026-01-01T00:15:00.000Z');

function storedAsset(
  id: string,
  overrides: Partial<StoredAttachment> = {},
): StoredAttachment {
  return {
    id,
    uploaderId: ME,
    visibility: 'PRIVATE',
    storageKey: `chat/${ME}/${id}`,
    mimeType: 'image/png',
    size: 100,
    originalName: `${id}.png`,
    ...overrides,
  };
}

function attachmentFile(
  assetId: string,
  displayOrder: number,
  mimeType = 'image/png',
): MessageAttachmentFile {
  return {
    assetId,
    displayOrder,
    storageKey: `chat/${ME}/${assetId}`,
    mimeType,
    size: 100,
    originalName: `${assetId}.bin`,
  };
}

function makeChat(lastSeq = 4): Chat {
  const chat = Chat.createDirect(ME, OTHER);
  chat.id = CHAT_ID;
  chat.lastSeq = lastSeq;
  for (const p of chat.participants) p.chatId = CHAT_ID;
  return chat;
}

function persisted(message: Message, id = 'm-1'): Message {
  message.id = id;
  message.createdAt = new Date('2026-01-01T00:00:00.000Z');
  message.updatedAt = message.createdAt;
  return message;
}

function existingMessage(): Message {
  return persisted(
    Message.create({
      chatId: CHAT_ID,
      authorId: ME,
      content: 'hello',
      clientMessageId: CLIENT_ID,
      seq: 3,
    }),
    'm-original',
  );
}

const dto: SendMessageDto = { clientMessageId: CLIENT_ID, content: ' hi ' };

describe('MessagesService', () => {
  let service: MessagesService;
  let chat: Chat;
  const tx = { tx: true };
  let committed: boolean;
  let committedAtEmit: boolean[];

  const chatRepo = {
    findById: jest.fn(),
    save: jest.fn(),
    advanceReadSeq: jest.fn(),
    findByIdForUpdate: jest.fn(),
    runInTransaction: jest.fn(),
  };
  const messageRepo = {
    allocateSeq: jest.fn(),
    insert: jest.fn(),
    findByClientMessageId: jest.fn(),
    findById: jest.fn(),
    findVisibleById: jest.fn(),
    update: jest.fn(),
    pageHistory: jest.fn(),
    pageChanges: jest.fn(),
    insertAttachments: jest.fn(),
    findAttachedAssetIds: jest.fn(),
  };
  const storage = {
    upload: jest.fn(),
    findAssets: jest.fn(),
    softDeleteAssets: jest.fn(),
    presign: jest.fn(),
    deleteObjects: jest.fn(),
  };
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const realtime = {
    emitToChat: jest.fn(),
    emitToUser: jest.fn(),
    joinUserToChat: jest.fn(),
    removeUserFromChat: jest.fn(),
    isUserViewingChat: jest.fn(),
    emitTypingStopped: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    chat = makeChat();
    committed = false;
    committedAtEmit = [];

    chatRepo.findById.mockResolvedValue(chat);
    chatRepo.findByIdForUpdate.mockResolvedValue(chat);
    chatRepo.advanceReadSeq.mockImplementation(
      (_c: string, _u: string, seq: number) => Promise.resolve(seq),
    );
    chatRepo.runInTransaction.mockImplementation(
      async (work: (t: unknown) => Promise<unknown>) => {
        const result = await work(tx);
        committed = true;
        return result;
      },
    );
    messageRepo.findByClientMessageId.mockResolvedValue(null);
    messageRepo.allocateSeq.mockResolvedValue(5);
    messageRepo.update.mockImplementation((m: Message) => Promise.resolve(m));
    messageRepo.insert.mockImplementation((m: Message) =>
      Promise.resolve(persisted(m)),
    );
    realtime.emitToChat.mockImplementation(() => {
      committedAtEmit.push(committed);
    });
    messageRepo.findAttachedAssetIds.mockResolvedValue([]);
    messageRepo.insertAttachments.mockResolvedValue(undefined);
    storage.findAssets.mockResolvedValue([]);
    storage.softDeleteAssets.mockResolvedValue(undefined);
    storage.deleteObjects.mockResolvedValue(undefined);
    storage.presign.mockImplementation((a: { storageKey: string }) =>
      Promise.resolve({
        url: `https://signed/${a.storageKey}`,
        expiresAt: EXPIRES,
      }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: CHAT_REPOSITORY, useValue: chatRepo },
        { provide: MESSAGE_REPOSITORY, useValue: messageRepo },
        { provide: CHAT_REALTIME_PORT, useValue: realtime },
        { provide: ATTACHMENT_STORAGE_PORT, useValue: storage },
        { provide: LoggerKey, useValue: logger },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  describe('send', () => {
    it('rejects a non-participant with ChatNotFoundError', async () => {
      await expect(service.send(STRANGER, CHAT_ID, dto)).rejects.toThrow(
        ChatNotFoundError,
      );
      expect(messageRepo.insert).not.toHaveBeenCalled();
      expect(realtime.emitToChat).not.toHaveBeenCalled();
    });

    it('rejects an unknown chat with ChatNotFoundError', async () => {
      chatRepo.findById.mockResolvedValue(null);
      await expect(service.send(ME, CHAT_ID, dto)).rejects.toThrow(
        ChatNotFoundError,
      );
    });

    it('creates the message and emits message:new only after commit', async () => {
      const result = await service.send(ME, CHAT_ID, dto);

      expect(result.created).toBe(true);
      expect(result.message).toMatchObject({
        chatId: CHAT_ID,
        authorId: ME,
        content: 'hi',
        seq: 5,
        changeSeq: 5,
        clientMessageId: CLIENT_ID,
      });
      expect(messageRepo.allocateSeq).toHaveBeenCalledWith(CHAT_ID, tx);
      expect(messageRepo.insert).toHaveBeenCalledWith(expect.any(Message), tx);
      expect(realtime.emitToChat).toHaveBeenCalledTimes(1);
      expect(committedAtEmit).toEqual([true]);
      expect(realtime.emitToChat).toHaveBeenCalledWith(CHAT_ID, 'message:new', {
        message: result.message,
      });
    });

    it('emits typing stopped for the sender after commit', async () => {
      realtime.emitTypingStopped.mockImplementation(() => {
        committedAtEmit.push(committed);
      });

      await service.send(ME, CHAT_ID, dto);

      expect(realtime.emitTypingStopped).toHaveBeenCalledWith(CHAT_ID, ME);
      expect(committedAtEmit).toEqual([true, true]);
    });

    it('does not emit typing stopped for a replay', async () => {
      messageRepo.findByClientMessageId.mockResolvedValue(existingMessage());

      await service.send(ME, CHAT_ID, dto);

      expect(realtime.emitTypingStopped).not.toHaveBeenCalled();
    });

    it("moves the sender's lastReadSeq to the new seq inside the transaction", async () => {
      await service.send(ME, CHAT_ID, dto);

      expect(chatRepo.advanceReadSeq).toHaveBeenCalledWith(CHAT_ID, ME, 5, tx);
      expect(chatRepo.save).not.toHaveBeenCalled();
    });

    it('still resolves with created: true when the emit fails', async () => {
      realtime.emitToChat.mockImplementation(() => {
        throw new Error('socket down');
      });

      const result = await service.send(ME, CHAT_ID, dto);

      expect(result.created).toBe(true);
      expect(result.message.seq).toBe(5);
    });

    it('returns the original message for a repeated clientMessageId and emits nothing', async () => {
      const original = existingMessage();
      messageRepo.findByClientMessageId.mockResolvedValue(original);

      const result = await service.send(ME, CHAT_ID, dto);

      expect(result.created).toBe(false);
      expect(result.message.id).toBe('m-original');
      expect(messageRepo.findByClientMessageId).toHaveBeenCalledWith(
        CHAT_ID,
        ME,
        CLIENT_ID,
      );
      expect(chatRepo.runInTransaction).not.toHaveBeenCalled();
      expect(realtime.emitToChat).not.toHaveBeenCalled();
    });

    it('re-reads and returns the original on a unique-violation race', async () => {
      const original = existingMessage();
      messageRepo.findByClientMessageId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(original);
      messageRepo.insert.mockRejectedValue(
        new UniqueConstraintViolationError('messages', 'duplicate'),
      );

      const result = await service.send(ME, CHAT_ID, dto);

      expect(result.created).toBe(false);
      expect(result.message.id).toBe('m-original');
      expect(messageRepo.findByClientMessageId).toHaveBeenCalledTimes(2);
      expect(realtime.emitToChat).not.toHaveBeenCalled();
    });

    it('rethrows a unique violation when no original can be found', async () => {
      const error = new UniqueConstraintViolationError('messages', 'seq');
      messageRepo.insert.mockRejectedValue(error);

      await expect(service.send(ME, CHAT_ID, dto)).rejects.toBe(error);
      expect(realtime.emitToChat).not.toHaveBeenCalled();
    });
  });

  describe('send with attachments', () => {
    const withFiles: SendMessageDto = {
      clientMessageId: CLIENT_ID,
      attachmentIds: [ASSET_2, ASSET_1],
    };

    beforeEach(() => {
      storage.findAssets.mockResolvedValue([
        storedAsset(ASSET_1),
        storedAsset(ASSET_2, { mimeType: 'application/pdf' }),
      ]);
    });

    it('loads candidates through the storage port and passes them to Message.create', async () => {
      const create = jest.spyOn(Message, 'create');

      await service.send(ME, CHAT_ID, withFiles);

      expect(storage.findAssets).toHaveBeenCalledWith([ASSET_2, ASSET_1], tx);
      expect(messageRepo.findAttachedAssetIds).toHaveBeenCalledWith(
        [ASSET_2, ASSET_1],
        tx,
      );
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [
            {
              assetId: ASSET_2,
              found: true,
              uploaderId: ME,
              visibility: 'PRIVATE',
              alreadyAttached: false,
            },
            {
              assetId: ASSET_1,
              found: true,
              uploaderId: ME,
              visibility: 'PRIVATE',
              alreadyAttached: false,
            },
          ],
        }),
      );
      create.mockRestore();
    });

    it('passes missing and already attached assets on to the domain, which rejects them', async () => {
      storage.findAssets.mockResolvedValue([storedAsset(ASSET_1)]);
      await expect(service.send(ME, CHAT_ID, withFiles)).rejects.toThrow(
        InvalidAttachmentError,
      );

      storage.findAssets.mockResolvedValue([
        storedAsset(ASSET_1),
        storedAsset(ASSET_2),
      ]);
      messageRepo.findAttachedAssetIds.mockResolvedValue([ASSET_1]);
      await expect(service.send(ME, CHAT_ID, withFiles)).rejects.toThrow(
        InvalidAttachmentError,
      );

      expect(messageRepo.insert).not.toHaveBeenCalled();
      expect(realtime.emitToChat).not.toHaveBeenCalled();
    });

    it('stores the links in the tx with displayOrder matching request order', async () => {
      await service.send(ME, CHAT_ID, withFiles);

      expect(messageRepo.insertAttachments).toHaveBeenCalledWith(
        'm-1',
        [
          { assetId: ASSET_2, displayOrder: 0 },
          { assetId: ASSET_1, displayOrder: 1 },
        ],
        tx,
      );
    });

    it('maps a unique violation on assetId to InvalidAttachmentError', async () => {
      messageRepo.insertAttachments.mockRejectedValue(
        new UniqueConstraintViolationError('message_assets', 'assetId'),
      );

      await expect(service.send(ME, CHAT_ID, withFiles)).rejects.toThrow(
        InvalidAttachmentError,
      );
      expect(messageRepo.findByClientMessageId).toHaveBeenCalledTimes(1);
      expect(realtime.emitToChat).not.toHaveBeenCalled();
    });

    it('returns presigned attachments in display order', async () => {
      const result = await service.send(ME, CHAT_ID, withFiles);

      expect(result.message.attachments).toEqual([
        {
          id: ASSET_2,
          mimeType: 'application/pdf',
          size: 100,
          originalName: `${ASSET_2}.png`,
          displayOrder: 0,
          url: `https://signed/chat/${ME}/${ASSET_2}`,
          urlExpiresAt: EXPIRES.toISOString(),
          kind: 'file',
        },
        expect.objectContaining({
          id: ASSET_1,
          displayOrder: 1,
          kind: 'image',
        }),
      ]);
    });

    it('does not touch storage for a text-only message', async () => {
      await service.send(ME, CHAT_ID, dto);

      expect(storage.findAssets).not.toHaveBeenCalled();
      expect(messageRepo.insertAttachments).not.toHaveBeenCalled();
    });
  });

  describe('edit / delete', () => {
    const MESSAGE_ID = 'm-1';
    let stored: Message;

    beforeEach(() => {
      stored = persisted(
        Message.create({
          chatId: CHAT_ID,
          authorId: ME,
          content: 'old',
          clientMessageId: CLIENT_ID,
          seq: 3,
        }),
        MESSAGE_ID,
      );
      messageRepo.findVisibleById.mockResolvedValue(stored);
      messageRepo.allocateSeq.mockResolvedValue(6);
    });

    describe('edit', () => {
      it('allocates a new changeSeq in the tx and emits message:updated after commit', async () => {
        const result = await service.edit(ME, CHAT_ID, MESSAGE_ID, {
          content: ' new ',
        });

        expect(chatRepo.findByIdForUpdate).toHaveBeenCalledWith(CHAT_ID, tx);
        expect(messageRepo.findVisibleById).toHaveBeenCalledWith(
          CHAT_ID,
          MESSAGE_ID,
          0,
          tx,
        );
        expect(messageRepo.allocateSeq).toHaveBeenCalledWith(CHAT_ID, tx);
        expect(messageRepo.update).toHaveBeenCalledWith(stored, tx);
        expect(result).toMatchObject({
          id: MESSAGE_ID,
          content: 'new',
          seq: 3,
          changeSeq: 6,
        });
        expect(result.editedAt).not.toBeNull();
        expect(committedAtEmit).toEqual([true]);
        expect(realtime.emitToChat).toHaveBeenCalledWith(
          CHAT_ID,
          'message:updated',
          { message: result },
        );
      });

      it('rejects a non-author with NotMessageAuthorError and emits nothing', async () => {
        messageRepo.findVisibleById.mockResolvedValue(
          persisted(
            Message.create({
              chatId: CHAT_ID,
              authorId: OTHER,
              content: 'theirs',
              clientMessageId: 'c9',
              seq: 3,
            }),
          ),
        );

        await expect(
          service.edit(ME, CHAT_ID, MESSAGE_ID, { content: 'x' }),
        ).rejects.toThrow(NotMessageAuthorError);
        expect(messageRepo.update).not.toHaveBeenCalled();
        expect(realtime.emitToChat).not.toHaveBeenCalled();
      });

      it('rejects blank text when the message has no attachments', async () => {
        await expect(
          service.edit(ME, CHAT_ID, MESSAGE_ID, { content: '   ' }),
        ).rejects.toThrow(EmptyMessageError);
      });

      it('allows blank text when the message has attachments', async () => {
        stored.attachmentIds = ['asset-1'];

        const result = await service.edit(ME, CHAT_ID, MESSAGE_ID, {
          content: '',
        });

        expect(result.content).toBeNull();
      });

      it('rejects a deleted message with MessageAlreadyDeletedError', async () => {
        stored.deletedAt = new Date();

        await expect(
          service.edit(ME, CHAT_ID, MESSAGE_ID, { content: 'x' }),
        ).rejects.toThrow(MessageAlreadyDeletedError);
      });

      it('rejects a non-participant with ChatNotFoundError', async () => {
        await expect(
          service.edit(STRANGER, CHAT_ID, MESSAGE_ID, { content: 'x' }),
        ).rejects.toThrow(ChatNotFoundError);
        expect(messageRepo.findVisibleById).not.toHaveBeenCalled();
        expect(realtime.emitToChat).not.toHaveBeenCalled();
      });

      it('rejects an unknown chat with ChatNotFoundError', async () => {
        chatRepo.findByIdForUpdate.mockResolvedValue(null);

        await expect(
          service.edit(ME, CHAT_ID, MESSAGE_ID, { content: 'x' }),
        ).rejects.toThrow(ChatNotFoundError);
      });

      it('rejects a message from before the caller joined with ChatNotFoundError', async () => {
        chat.participantOf(ME)!.joinedSeq = 3;
        messageRepo.findVisibleById.mockResolvedValue(null);
        messageRepo.findById.mockResolvedValue(stored);

        await expect(
          service.edit(ME, CHAT_ID, MESSAGE_ID, { content: 'x' }),
        ).rejects.toThrow(ChatNotFoundError);
        expect(messageRepo.findVisibleById).toHaveBeenCalledWith(
          CHAT_ID,
          MESSAGE_ID,
          3,
          tx,
        );
        expect(realtime.emitToChat).not.toHaveBeenCalled();
      });

      it('rejects a missing message with MessageNotFoundError', async () => {
        messageRepo.findVisibleById.mockResolvedValue(null);
        messageRepo.findById.mockResolvedValue(null);

        await expect(
          service.edit(ME, CHAT_ID, MESSAGE_ID, { content: 'x' }),
        ).rejects.toThrow(MessageNotFoundError);
      });

      it('rejects a message of another chat with MessageNotFoundError', async () => {
        messageRepo.findVisibleById.mockResolvedValue(null);
        messageRepo.findById.mockResolvedValue(
          Object.assign(stored, { chatId: 'other-chat' }),
        );

        await expect(
          service.edit(ME, CHAT_ID, MESSAGE_ID, { content: 'x' }),
        ).rejects.toThrow(MessageNotFoundError);
      });

      it('still resolves when the emit fails', async () => {
        realtime.emitToChat.mockImplementation(() => {
          throw new Error('socket down');
        });

        const result = await service.edit(ME, CHAT_ID, MESSAGE_ID, {
          content: 'new',
        });

        expect(result.changeSeq).toBe(6);
      });
    });

    describe('delete', () => {
      it('allocates a new changeSeq, tombstones, and emits message:deleted after commit', async () => {
        await service.delete(ME, CHAT_ID, MESSAGE_ID);

        expect(messageRepo.allocateSeq).toHaveBeenCalledWith(CHAT_ID, tx);
        expect(messageRepo.update).toHaveBeenCalledWith(stored, tx);
        expect(stored.deletedAt).not.toBeNull();
        expect(stored.content).toBeNull();
        expect(stored.changeSeq).toBe(6);
        expect(committedAtEmit).toEqual([true]);
        expect(realtime.emitToChat).toHaveBeenCalledWith(
          CHAT_ID,
          'message:deleted',
          { chatId: CHAT_ID, messageId: MESSAGE_ID, changeSeq: 6 },
        );
      });

      it('rejects a non-author and emits nothing', async () => {
        await expect(
          service.delete(OTHER, CHAT_ID, MESSAGE_ID),
        ).rejects.toThrow(NotMessageAuthorError);
        expect(messageRepo.update).not.toHaveBeenCalled();
        expect(realtime.emitToChat).not.toHaveBeenCalled();
      });

      it('rejects a deleted message with MessageAlreadyDeletedError', async () => {
        stored.deletedAt = new Date();

        await expect(service.delete(ME, CHAT_ID, MESSAGE_ID)).rejects.toThrow(
          MessageAlreadyDeletedError,
        );
      });

      it('rejects a non-participant with ChatNotFoundError', async () => {
        await expect(
          service.delete(STRANGER, CHAT_ID, MESSAGE_ID),
        ).rejects.toThrow(ChatNotFoundError);
      });

      it('rejects a message from before the caller joined with ChatNotFoundError', async () => {
        messageRepo.findVisibleById.mockResolvedValue(null);
        messageRepo.findById.mockResolvedValue(stored);

        await expect(service.delete(ME, CHAT_ID, MESSAGE_ID)).rejects.toThrow(
          ChatNotFoundError,
        );
      });

      it('runs the attachment hook with the removed asset ids', async () => {
        stored.attachmentIds = ['a1', 'a2'];
        const hook = jest
          .spyOn(service, 'onMessageDeleted')
          .mockResolvedValue([]);

        await service.delete(ME, CHAT_ID, MESSAGE_ID);

        expect(hook).toHaveBeenCalledWith(
          CHAT_ID,
          MESSAGE_ID,
          ['a1', 'a2'],
          tx,
        );
      });

      it('soft-deletes the assets in the tx and deletes the objects after commit', async () => {
        stored.attachmentIds = [ASSET_1, ASSET_2];
        storage.findAssets.mockResolvedValue([
          storedAsset(ASSET_1),
          storedAsset(ASSET_2),
        ]);
        const order: string[] = [];
        storage.softDeleteAssets.mockImplementation(() => {
          order.push(`soft:${committed}`);
          return Promise.resolve();
        });
        storage.deleteObjects.mockImplementation(() => {
          order.push(`objects:${committed}`);
          return Promise.resolve();
        });

        await service.delete(ME, CHAT_ID, MESSAGE_ID);

        expect(storage.findAssets).toHaveBeenCalledWith([ASSET_1, ASSET_2], tx);
        expect(storage.softDeleteAssets).toHaveBeenCalledWith(
          [ASSET_1, ASSET_2],
          tx,
        );
        expect(storage.deleteObjects).toHaveBeenCalledWith([
          `chat/${ME}/${ASSET_1}`,
          `chat/${ME}/${ASSET_2}`,
        ]);
        expect(order).toEqual(['soft:false', 'objects:true']);
      });

      it('logs, but does not throw, when deleting the objects fails', async () => {
        stored.attachmentIds = [ASSET_1];
        storage.findAssets.mockResolvedValue([storedAsset(ASSET_1)]);
        storage.deleteObjects.mockRejectedValue(new Error('s3 down'));

        await expect(
          service.delete(ME, CHAT_ID, MESSAGE_ID),
        ).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
        expect(realtime.emitToChat).toHaveBeenCalledWith(
          CHAT_ID,
          'message:deleted',
          expect.anything(),
        );
      });

      it('does not touch storage when the message has no attachments', async () => {
        await service.delete(ME, CHAT_ID, MESSAGE_ID);

        expect(storage.softDeleteAssets).not.toHaveBeenCalled();
        expect(storage.deleteObjects).not.toHaveBeenCalled();
      });
    });
  });

  describe('attachmentUrl', () => {
    const MESSAGE_ID = 'm-1';
    let stored: Message;

    beforeEach(() => {
      stored = persisted(
        Message.create({
          chatId: CHAT_ID,
          authorId: OTHER,
          clientMessageId: CLIENT_ID,
          seq: 3,
          attachments: [
            {
              assetId: ASSET_1,
              found: true,
              uploaderId: OTHER,
              visibility: 'PRIVATE',
              alreadyAttached: false,
            },
          ],
        }),
        MESSAGE_ID,
      );
      stored.attachments = [attachmentFile(ASSET_1, 0)];
      messageRepo.findVisibleById.mockResolvedValue(stored);
    });

    it('returns a fresh URL for a participant who can see the message', async () => {
      chat.participantOf(ME)!.joinedSeq = 1;

      const result = await service.attachmentUrl(
        ME,
        CHAT_ID,
        MESSAGE_ID,
        ASSET_1,
      );

      expect(messageRepo.findVisibleById).toHaveBeenCalledWith(
        CHAT_ID,
        MESSAGE_ID,
        1,
      );
      expect(storage.presign).toHaveBeenCalledWith(stored.attachments[0]);
      expect(result).toEqual({
        url: `https://signed/chat/${ME}/${ASSET_1}`,
        expiresAt: EXPIRES.toISOString(),
      });
    });

    it('rejects a non-participant with ChatNotFoundError', async () => {
      await expect(
        service.attachmentUrl(STRANGER, CHAT_ID, MESSAGE_ID, ASSET_1),
      ).rejects.toThrow(ChatNotFoundError);
      expect(storage.presign).not.toHaveBeenCalled();
    });

    it('rejects an invisible, deleted or foreign attachment with MessageNotFoundError', async () => {
      messageRepo.findVisibleById.mockResolvedValueOnce(null);
      await expect(
        service.attachmentUrl(ME, CHAT_ID, MESSAGE_ID, ASSET_1),
      ).rejects.toThrow(MessageNotFoundError);

      await expect(
        service.attachmentUrl(ME, CHAT_ID, MESSAGE_ID, ASSET_2),
      ).rejects.toThrow(MessageNotFoundError);

      stored.deletedAt = new Date();
      await expect(
        service.attachmentUrl(ME, CHAT_ID, MESSAGE_ID, ASSET_1),
      ).rejects.toThrow(MessageNotFoundError);
      expect(storage.presign).not.toHaveBeenCalled();
    });
  });

  describe('uploadAttachment', () => {
    it('stores the file through the port and returns its metadata', async () => {
      storage.upload.mockResolvedValue(
        storedAsset(ASSET_1, { originalName: 'cat.png' }),
      );
      const file = { originalname: 'cat.png' } as Express.Multer.File;

      const result = await service.uploadAttachment(ME, file);

      expect(storage.upload).toHaveBeenCalledWith(ME, file);
      expect(result).toEqual({
        id: ASSET_1,
        mimeType: 'image/png',
        size: 100,
        originalName: 'cat.png',
      });
    });
  });

  describe('history', () => {
    it("pages from the caller's joinedSeq and reports hasMore", async () => {
      chat.participantOf(ME)!.joinedSeq = 2;
      const rows = [5, 4, 3].map((seq) =>
        persisted(
          Message.create({
            chatId: CHAT_ID,
            authorId: OTHER,
            content: `m${seq}`,
            clientMessageId: `c${seq}`,
            seq,
          }),
          `m${seq}`,
        ),
      );
      messageRepo.pageHistory.mockResolvedValue(rows);

      const page = await service.history(ME, CHAT_ID, {
        beforeSeq: 6,
        limit: 2,
      });

      expect(messageRepo.pageHistory).toHaveBeenCalledWith(CHAT_ID, 2, {
        beforeSeq: 6,
        limit: 3,
      });
      expect(page.hasMore).toBe(true);
      expect(page.items.map((m) => m.seq)).toEqual([5, 4]);
    });

    it('presigns the attachments of the page and leaves deleted ones empty', async () => {
      const make = (seq: number) =>
        persisted(
          Message.create({
            chatId: CHAT_ID,
            authorId: OTHER,
            content: 'x',
            clientMessageId: `c${seq}`,
            seq,
          }),
          `m${seq}`,
        );
      const withFiles = make(5);
      withFiles.attachments = [
        attachmentFile(ASSET_2, 1, 'video/mp4'),
        attachmentFile(ASSET_1, 0),
      ];
      const deleted = make(4);
      deleted.deletedAt = new Date();
      messageRepo.pageHistory.mockResolvedValue([withFiles, deleted]);

      const page = await service.history(ME, CHAT_ID, { limit: 50 });

      expect(storage.presign).toHaveBeenCalledTimes(2);
      expect(page.items[0].attachments.map((a) => [a.id, a.kind])).toEqual([
        [ASSET_1, 'image'],
        [ASSET_2, 'video'],
      ]);
      expect(page.items[1].attachments).toEqual([]);
    });

    it('rejects a non-participant', async () => {
      await expect(
        service.history(STRANGER, CHAT_ID, { limit: 50 }),
      ).rejects.toThrow(ChatNotFoundError);
    });
  });

  describe('changes', () => {
    it("pages changes from the caller's joinedSeq", async () => {
      chat.participantOf(ME)!.joinedSeq = 1;
      messageRepo.pageChanges.mockResolvedValue([]);

      const page = await service.changes(ME, CHAT_ID, {
        afterChangeSeq: 3,
        limit: 200,
      });

      expect(messageRepo.pageChanges).toHaveBeenCalledWith(CHAT_ID, 1, {
        afterChangeSeq: 3,
        limit: 201,
      });
      expect(page).toEqual({ items: [], hasMore: false });
    });
  });
});
