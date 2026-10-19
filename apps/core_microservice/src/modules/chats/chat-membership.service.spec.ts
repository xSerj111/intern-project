import { Test, type TestingModule } from '@nestjs/testing';
import { LoggerKey } from '@repo/shared';
import { ChatMembershipService } from './chat-membership.service';
import { Chat } from './domain/entities/chat.entity';
import { ParticipantRole } from './domain/entities/chat-participant.entity';
import { Message } from './domain/entities/message.entity';
import {
  ChatNotFoundError,
  NotChatAdminError,
} from './domain/errors/chat.errors';
import {
  CHAT_REPOSITORY,
  type ChatSummary,
} from './domain/interfaces/chat-repository.port';
import { MESSAGE_REPOSITORY } from './domain/interfaces/message-repository.port';
import { CHAT_REALTIME_PORT } from './domain/interfaces/chat-realtime.port';
import { USER_DIRECTORY_PORT } from '../profiles/domain/interfaces/user-directory.port';
import { UserNotFoundError } from '../profiles/domain/errors/user-profile.errors';

const ME = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const C = '66666666-6666-4666-8666-666666666666';
const STRANGER = '77777777-7777-4777-8777-777777777777';
const CHAT_ID = '44444444-4444-4444-8444-444444444444';
const LAST_SEQ = 7;

function makeGroup(): Chat {
  const { chat } = Chat.createGroup(ME, 'Team', [A, B]);
  chat.id = CHAT_ID;
  chat.lastSeq = LAST_SEQ;
  for (const p of chat.participants) p.chatId = CHAT_ID;
  return chat;
}

function summaryOf(chat: Chat, userId: string): ChatSummary | null {
  const me = chat.participantOf(userId);
  if (!me) return null;
  return {
    chat,
    unreadCount: 0,
    lastMessage: null,
    memberCount: chat.activeParticipants().length,
    counterpart: null,
    myRole: me.role,
  };
}

describe('ChatMembershipService', () => {
  let service: ChatMembershipService;
  let chat: Chat;
  let saved: Chat | undefined;
  let nextSeq: number;
  let committed: boolean;
  /** Ordered log of tx writes and post-commit realtime calls. */
  let log: string[];
  const tx = { tx: true };

  const chatRepo = {
    findById: jest.fn(),
    findByIdForUpdate: jest.fn(),
    save: jest.fn(),
    getSummary: jest.fn(),
    runInTransaction: jest.fn(),
    upsertActiveMember: jest.fn(),
    markParticipantLeft: jest.fn(),
    setParticipantRole: jest.fn(),
    setTitle: jest.fn(),
    advanceReadSeq: jest.fn(),
  };
  const messageRepo = {
    allocateSeq: jest.fn(),
    insert: jest.fn(),
  };
  const userDirectory = {
    getUsers: jest.fn(),
    assertUsersExist: jest.fn(),
  };
  const realtime = {
    emitToChat: jest.fn(),
    emitToUser: jest.fn(),
    joinUserToChat: jest.fn(),
    removeUserFromChat: jest.fn(),
    isUserViewingChat: jest.fn(),
  };

  const inTx = (name: string) =>
    jest.fn((...args: unknown[]) => {
      log.push(`${name}${committed ? '' : '@tx'}`);
      expect(args[args.length - 1]).toBe(tx);
      return Promise.resolve();
    });

  beforeEach(async () => {
    jest.resetAllMocks();
    chat = makeGroup();
    saved = undefined;
    nextSeq = LAST_SEQ + 1;
    committed = false;
    log = [];

    chatRepo.findByIdForUpdate.mockImplementation(() => Promise.resolve(chat));
    chatRepo.findById.mockImplementation(() => Promise.resolve(chat));
    chatRepo.save.mockImplementation((c: Chat) => {
      c.id = CHAT_ID;
      for (const p of c.participants) p.chatId = CHAT_ID;
      saved = c;
      log.push('save@tx');
      return Promise.resolve(c);
    });
    chatRepo.getSummary.mockImplementation((_id: string, userId: string) =>
      Promise.resolve(summaryOf(saved ?? chat, userId)),
    );
    chatRepo.runInTransaction.mockImplementation(
      async (work: (t: unknown) => Promise<unknown>) => {
        const result = await work(tx);
        committed = true;
        return result;
      },
    );
    for (const name of [
      'upsertActiveMember',
      'markParticipantLeft',
      'setParticipantRole',
      'setTitle',
    ] as const) {
      chatRepo[name].mockImplementation(inTx(name));
    }
    messageRepo.allocateSeq.mockImplementation(() => {
      log.push(committed ? 'allocateSeq' : 'allocateSeq@tx');
      return Promise.resolve(nextSeq++);
    });
    messageRepo.insert.mockImplementation((m: Message) => {
      log.push(committed ? 'insert' : 'insert@tx');
      m.id = `m-${m.seq}`;
      m.createdAt = new Date('2026-01-01T00:00:00.000Z');
      m.updatedAt = m.createdAt;
      return Promise.resolve(m);
    });
    userDirectory.getUsers.mockResolvedValue(new Map());
    userDirectory.assertUsersExist.mockResolvedValue(undefined);
    realtime.joinUserToChat.mockImplementation((u: string) =>
      log.push(`join:${u}`),
    );
    realtime.removeUserFromChat.mockImplementation((u: string) =>
      log.push(`leaveRoom:${u}`),
    );
    realtime.emitToUser.mockImplementation((u: string, event: string) =>
      log.push(`${event}:${u}`),
    );
    realtime.emitToChat.mockImplementation(
      (_c: string, event: string, payload: { message: { seq: number } }) =>
        log.push(`${event}#${payload.message.seq}`),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatMembershipService,
        { provide: CHAT_REPOSITORY, useValue: chatRepo },
        { provide: MESSAGE_REPOSITORY, useValue: messageRepo },
        { provide: USER_DIRECTORY_PORT, useValue: userDirectory },
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

    service = module.get(ChatMembershipService);
  });

  function insertedMessages(): Message[] {
    return messageRepo.insert.mock.calls.map(([m]) => m as Message);
  }

  describe('createGroup', () => {
    it('checks every member exists before writing', async () => {
      userDirectory.assertUsersExist.mockRejectedValue(
        new UserNotFoundError([C]),
      );

      await expect(
        service.createGroup(ME, { title: 'Team', memberIds: [A, C] }),
      ).rejects.toThrow(UserNotFoundError);
      expect(userDirectory.assertUsersExist).toHaveBeenCalledWith([A, C]);
      expect(chatRepo.runInTransaction).not.toHaveBeenCalled();
    });

    it('inserts the chat and group_created in one transaction, then joins and upserts every member', async () => {
      const detail = await service.createGroup(ME, {
        title: ' Team ',
        memberIds: [A, B],
      });

      expect(messageRepo.allocateSeq).toHaveBeenCalledWith(CHAT_ID, tx);
      const [created] = insertedMessages();
      expect(created.kind).toBe('SYSTEM');
      expect(created.seq).toBe(LAST_SEQ + 1);
      expect(created.systemEvent).toMatchObject({
        type: 'group_created',
        actorId: ME,
        targetUserIds: [A, B],
        title: 'Team',
      });
      expect(log).toEqual([
        'save@tx',
        'allocateSeq@tx',
        'insert@tx',
        `join:${ME}`,
        `chat:upsert:${ME}`,
        `join:${A}`,
        `chat:upsert:${A}`,
        `join:${B}`,
        `chat:upsert:${B}`,
        `message:new#${LAST_SEQ + 1}`,
      ]);
      expect(detail).toMatchObject({ id: CHAT_ID, title: 'Team' });
      expect(detail.participants).toHaveLength(3);
    });
  });

  describe('rename', () => {
    it('writes the title and group_renamed in the transaction, then broadcasts and upserts', async () => {
      const detail = await service.rename(ME, CHAT_ID, { title: 'New' });

      expect(chatRepo.setTitle).toHaveBeenCalledWith(CHAT_ID, 'New', tx);
      expect(insertedMessages()[0].systemEvent).toMatchObject({
        type: 'group_renamed',
        title: 'New',
      });
      expect(log).toEqual([
        'allocateSeq@tx',
        'setTitle@tx',
        'insert@tx',
        `message:new#8`,
        `chat:upsert:${ME}`,
        `chat:upsert:${A}`,
        `chat:upsert:${B}`,
      ]);
      expect(chatRepo.save).not.toHaveBeenCalled();
      expect(detail.title).toBe('New');
    });

    it('rejects a non-admin with NotChatAdminError and writes nothing', async () => {
      await expect(
        service.rename(A, CHAT_ID, { title: 'New' }),
      ).rejects.toThrow(NotChatAdminError);
      expect(messageRepo.allocateSeq).not.toHaveBeenCalled();
      expect(realtime.emitToChat).not.toHaveBeenCalled();
    });

    it('hides the chat from a non-participant with ChatNotFoundError', async () => {
      await expect(
        service.rename(STRANGER, CHAT_ID, { title: 'New' }),
      ).rejects.toThrow(ChatNotFoundError);
    });

    it('rejects a missing chat with ChatNotFoundError', async () => {
      chatRepo.findByIdForUpdate.mockResolvedValue(null);
      await expect(
        service.rename(ME, CHAT_ID, { title: 'New' }),
      ).rejects.toThrow(ChatNotFoundError);
    });
  });

  describe('addMembers', () => {
    it('adds through a narrow write joined just before member_added, then joins and upserts the new member first', async () => {
      await service.addMembers(ME, CHAT_ID, { userIds: [C, A] });

      expect(userDirectory.assertUsersExist).toHaveBeenCalledWith([C, A]);
      // joinedSeq = seq of member_added - 1, so the added member sees it.
      expect(chatRepo.upsertActiveMember).toHaveBeenCalledTimes(1);
      expect(chatRepo.upsertActiveMember).toHaveBeenCalledWith(
        CHAT_ID,
        C,
        LAST_SEQ,
        tx,
      );
      expect(insertedMessages()[0].systemEvent).toMatchObject({
        type: 'member_added',
        targetUserIds: [C],
      });
      expect(log).toEqual([
        'allocateSeq@tx',
        'upsertActiveMember@tx',
        'insert@tx',
        `join:${C}`,
        `chat:upsert:${C}`,
        `message:new#8`,
        `chat:upsert:${ME}`,
        `chat:upsert:${A}`,
        `chat:upsert:${B}`,
      ]);
      expect(chatRepo.save).not.toHaveBeenCalled();
    });

    it('writes and emits nothing when everyone is already a member', async () => {
      const detail = await service.addMembers(ME, CHAT_ID, { userIds: [A] });

      expect(messageRepo.allocateSeq).not.toHaveBeenCalled();
      expect(realtime.emitToChat).not.toHaveBeenCalled();
      expect(realtime.emitToUser).not.toHaveBeenCalled();
      expect(detail.id).toBe(CHAT_ID);
    });
  });

  describe('removeMember', () => {
    it('removes the user from the room and sends chat:removed before broadcasting member_removed', async () => {
      await service.removeMember(ME, CHAT_ID, A);

      expect(chatRepo.markParticipantLeft).toHaveBeenCalledWith(CHAT_ID, A, tx);
      expect(realtime.emitToUser).toHaveBeenCalledWith(A, 'chat:removed', {
        chatId: CHAT_ID,
        reason: 'removed',
      });
      expect(insertedMessages()[0].systemEvent).toMatchObject({
        type: 'member_removed',
        targetUserIds: [A],
      });
      expect(log).toEqual([
        'allocateSeq@tx',
        'markParticipantLeft@tx',
        'insert@tx',
        `leaveRoom:${A}`,
        `chat:removed:${A}`,
        `message:new#8`,
        `chat:upsert:${ME}`,
        `chat:upsert:${B}`,
      ]);
      expect(chatRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('leave', () => {
    it('writes member_left and the successor promotion with one seq each, evicting the leaver before the broadcast', async () => {
      await service.leave(ME, CHAT_ID);

      expect(messageRepo.allocateSeq).toHaveBeenCalledTimes(2);
      expect(chatRepo.markParticipantLeft).toHaveBeenCalledWith(
        CHAT_ID,
        ME,
        tx,
      );
      expect(chatRepo.setParticipantRole).toHaveBeenCalledWith(
        CHAT_ID,
        A,
        ParticipantRole.ADMIN,
        tx,
      );
      expect(insertedMessages().map((m) => m.systemEvent?.type)).toEqual([
        'member_left',
        'admin_promoted',
      ]);
      expect(realtime.emitToUser).toHaveBeenCalledWith(ME, 'chat:removed', {
        chatId: CHAT_ID,
        reason: 'left',
      });
      expect(log).toEqual([
        'allocateSeq@tx',
        'markParticipantLeft@tx',
        'insert@tx',
        'allocateSeq@tx',
        'setParticipantRole@tx',
        'insert@tx',
        `leaveRoom:${ME}`,
        `chat:removed:${ME}`,
        `message:new#8`,
        `message:new#9`,
        `chat:upsert:${A}`,
        `chat:upsert:${B}`,
      ]);
    });
  });

  describe('promote', () => {
    it('writes the role and admin_promoted in the transaction', async () => {
      await service.promote(ME, CHAT_ID, B);

      expect(chatRepo.setParticipantRole).toHaveBeenCalledWith(
        CHAT_ID,
        B,
        ParticipantRole.ADMIN,
        tx,
      );
      expect(log).toEqual([
        'allocateSeq@tx',
        'setParticipantRole@tx',
        'insert@tx',
        `message:new#8`,
        `chat:upsert:${ME}`,
        `chat:upsert:${A}`,
        `chat:upsert:${B}`,
      ]);
    });

    it('is a no-op for an existing admin', async () => {
      await service.promote(ME, CHAT_ID, ME);

      expect(messageRepo.allocateSeq).not.toHaveBeenCalled();
      expect(realtime.emitToChat).not.toHaveBeenCalled();
    });
  });

  it('still succeeds when a post-commit emit fails', async () => {
    realtime.emitToChat.mockImplementation(() => {
      throw new Error('socket down');
    });
    realtime.emitToUser.mockImplementation(() => {
      throw new Error('socket down');
    });

    await expect(service.removeMember(ME, CHAT_ID, A)).resolves.toBeUndefined();
    expect(chatRepo.markParticipantLeft).toHaveBeenCalled();
  });
});
