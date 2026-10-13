import { Test, type TestingModule } from '@nestjs/testing';
import { LoggerKey, UniqueConstraintViolationError } from '@repo/shared';
import { MessagesService } from './messages.service';
import { Chat } from './domain/entities/chat.entity';
import { Message } from './domain/entities/message.entity';
import { ChatNotFoundError } from './domain/errors/chat.errors';
import { CHAT_REPOSITORY } from './domain/interfaces/chat-repository.port';
import { MESSAGE_REPOSITORY } from './domain/interfaces/message-repository.port';
import { CHAT_REALTIME_PORT } from './domain/interfaces/chat-realtime.port';
import type { SendMessageDto } from './dto/send-message.dto';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const CHAT_ID = '44444444-4444-4444-8444-444444444444';
const CLIENT_ID = '55555555-5555-4555-8555-555555555555';

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
    runInTransaction: jest.fn(),
  };
  const messageRepo = {
    allocateSeq: jest.fn(),
    insert: jest.fn(),
    findByClientMessageId: jest.fn(),
    pageHistory: jest.fn(),
    pageChanges: jest.fn(),
  };
  const realtime = {
    emitToChat: jest.fn(),
    emitToUser: jest.fn(),
    joinUserToChat: jest.fn(),
    removeUserFromChat: jest.fn(),
    isUserViewingChat: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    chat = makeChat();
    committed = false;
    committedAtEmit = [];

    chatRepo.findById.mockResolvedValue(chat);
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
    messageRepo.insert.mockImplementation((m: Message) =>
      Promise.resolve(persisted(m)),
    );
    realtime.emitToChat.mockImplementation(() => {
      committedAtEmit.push(committed);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: CHAT_REPOSITORY, useValue: chatRepo },
        { provide: MESSAGE_REPOSITORY, useValue: messageRepo },
        { provide: CHAT_REALTIME_PORT, useValue: realtime },
        {
          provide: LoggerKey,
          useValue: {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
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
