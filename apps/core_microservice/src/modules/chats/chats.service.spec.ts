import { Test } from '@nestjs/testing';
import { LoggerKey, UniqueConstraintViolationError } from '@repo/shared';
import { ChatsService } from './chats.service';
import { Chat } from './domain/entities/chat.entity';
import {
  CannotChatWithSelfError,
  ChatNotFoundError,
} from './domain/errors/chat.errors';
import { CHAT_REALTIME_PORT } from './domain/interfaces/chat-realtime.port';
import { CHAT_REPOSITORY } from './domain/interfaces/chat-repository.port';
import { USER_DIRECTORY_PORT } from '../profiles/domain/interfaces/user-directory.port';
import { UserNotFoundError } from '../profiles/domain/errors/user-profile.errors';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const user = (userId: string) => ({
  userId,
  username: `u-${userId.slice(0, 2)}`,
  displayName: `User ${userId.slice(0, 2)}`,
  avatarUrl: null,
});

function persisted(a = ME, b = OTHER): Chat {
  const chat = Chat.createDirect(a, b);
  chat.id = 'chat-1';
  return chat;
}

describe('ChatsService', () => {
  let service: ChatsService;
  const chats = {
    findById: jest.fn(),
    findDirectByKey: jest.fn(),
    listForUser: jest.fn(),
    save: jest.fn(),
    getSummary: jest.fn(),
    advanceReadSeq: jest.fn(),
    runInTransaction: jest.fn(),
  };
  const directory = { getUsers: jest.fn(), assertUsersExist: jest.fn() };
  const realtime = {
    emitToChat: jest.fn(),
    emitToUser: jest.fn(),
    joinUserToChat: jest.fn(),
    removeUserFromChat: jest.fn(),
    isUserViewingChat: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    chats.runInTransaction.mockImplementation(
      (work: (tx: unknown) => unknown) => work({}),
    );
    chats.save.mockImplementation((c: Chat) => {
      c.id = 'chat-1';
      return Promise.resolve(c);
    });
    chats.getSummary.mockImplementation((chatId: string, userId: string) => {
      const chat = persisted();
      chat.lastSeq = 5;
      return Promise.resolve({
        chat,
        unreadCount: 2,
        lastMessage: null,
        memberCount: 2,
        counterpart: chat.participants.find((x) => x.userId !== userId),
        myRole: 'MEMBER',
      });
    });
    directory.assertUsersExist.mockResolvedValue(undefined);
    directory.getUsers.mockResolvedValue(
      new Map([
        [ME, user(ME)],
        [OTHER, user(OTHER)],
      ]),
    );

    const module = await Test.createTestingModule({
      providers: [
        ChatsService,
        { provide: CHAT_REPOSITORY, useValue: chats },
        { provide: USER_DIRECTORY_PORT, useValue: directory },
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
    service = module.get(ChatsService);
  });

  describe('createDirect', () => {
    it('returns the existing chat with created=false', async () => {
      chats.findDirectByKey.mockResolvedValue(persisted());

      const result = await service.createDirect(ME, OTHER);

      expect(result.created).toBe(false);
      expect(result.chat.id).toBe('chat-1');
      expect(chats.save).not.toHaveBeenCalled();
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });

    it('rejects an unknown target with UserNotFoundError', async () => {
      directory.assertUsersExist.mockRejectedValue(
        new UserNotFoundError([OTHER]),
      );

      await expect(service.createDirect(ME, OTHER)).rejects.toBeInstanceOf(
        UserNotFoundError,
      );
      expect(chats.save).not.toHaveBeenCalled();
    });

    it('rejects a chat with yourself', async () => {
      await expect(service.createDirect(ME, ME)).rejects.toBeInstanceOf(
        CannotChatWithSelfError,
      );
    });

    it('creates a new pair, joins both users and sends chat:upsert', async () => {
      chats.findDirectByKey.mockResolvedValue(null);

      const result = await service.createDirect(ME, OTHER);

      expect(result.created).toBe(true);
      expect(realtime.joinUserToChat).toHaveBeenCalledWith(ME, 'chat-1');
      expect(realtime.joinUserToChat).toHaveBeenCalledWith(OTHER, 'chat-1');
      expect(realtime.emitToUser).toHaveBeenCalledTimes(2);
      const calls = realtime.emitToUser.mock.calls as [
        string,
        string,
        { conversation: { counterpart: { userId: string } } },
      ][];
      const mine = calls.find((c) => c[0] === ME);
      const theirs = calls.find((c) => c[0] === OTHER);
      expect(mine?.[1]).toBe('chat:upsert');
      expect(mine?.[2].conversation.counterpart.userId).toBe(OTHER);
      expect(theirs?.[2].conversation.counterpart.userId).toBe(ME);
    });

    it('re-reads the winner after a unique violation on directKey', async () => {
      chats.findDirectByKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(persisted());
      chats.save.mockRejectedValue(
        new UniqueConstraintViolationError('chats', 'directKey'),
      );

      const result = await service.createDirect(ME, OTHER);

      expect(result.created).toBe(false);
      expect(realtime.emitToUser).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('slices the extra row into hasMore', async () => {
      const rows = [1, 2, 3].map(() => ({
        chat: persisted(),
        unreadCount: 0,
        lastMessage: null,
        memberCount: 2,
        counterpart: persisted().participants[1],
        myRole: 'MEMBER',
      }));
      chats.listForUser.mockResolvedValue(rows);

      const page = await service.list(ME, { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      expect(chats.listForUser).toHaveBeenCalledWith(ME, {
        before: undefined,
        limit: 3,
      });
    });
  });

  describe('getDetail', () => {
    it('returns 404 for a non-participant', async () => {
      chats.findById.mockResolvedValue(
        persisted(OTHER, '33333333-3333-4333-8333-333333333333'),
      );

      await expect(service.getDetail(ME, 'chat-1')).rejects.toBeInstanceOf(
        ChatNotFoundError,
      );
    });
  });

  describe('markRead', () => {
    it('updates lastReadSeq and emits chat:read to the user', async () => {
      const chat = persisted();
      chat.lastSeq = 5;
      chats.findById.mockResolvedValue(chat);

      chats.advanceReadSeq.mockResolvedValue(3);

      const state = await service.markRead(ME, 'chat-1', 3);

      expect(state).toEqual({
        chatId: 'chat-1',
        lastReadSeq: 3,
        unreadCount: 2,
      });
      expect(chats.advanceReadSeq).toHaveBeenCalledWith('chat-1', ME, 3);
      expect(chats.save).not.toHaveBeenCalled();
      expect(realtime.emitToUser).toHaveBeenCalledWith(ME, 'chat:read', state);
    });
  });
});
