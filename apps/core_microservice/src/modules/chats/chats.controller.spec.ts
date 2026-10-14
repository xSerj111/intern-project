import { Test, TestingModule } from '@nestjs/testing';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
import { ChatMembershipService } from './chat-membership.service';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const makeRes = () => {
  const status = jest.fn();
  return { status, res: { status } as never };
};

describe('ChatsController / MessagesController', () => {
  let chats: ChatsController;
  let messages: MessagesController;
  let chatsService: { createDirect: jest.Mock; markRead: jest.Mock };
  let messagesService: { send: jest.Mock };
  let membership: {
    createGroup: jest.Mock;
    rename: jest.Mock;
    addMembers: jest.Mock;
    promote: jest.Mock;
    removeMember: jest.Mock;
    leave: jest.Mock;
  };

  beforeEach(async () => {
    chatsService = { createDirect: jest.fn(), markRead: jest.fn() };
    messagesService = { send: jest.fn() };
    membership = {
      createGroup: jest.fn(),
      rename: jest.fn(),
      addMembers: jest.fn(),
      promote: jest.fn(),
      removeMember: jest.fn(),
      leave: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatsController, MessagesController],
      providers: [
        { provide: ChatsService, useValue: chatsService },
        { provide: MessagesService, useValue: messagesService },
        { provide: ChatMembershipService, useValue: membership },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    chats = module.get(ChatsController);
    messages = module.get(MessagesController);
  });

  describe('POST /chats/direct', () => {
    it.each([
      [true, 201],
      [false, 200],
    ])('created=%s responds %i', async (created, status) => {
      const chat = { id: CHAT_ID };
      chatsService.createDirect.mockResolvedValue({ created, chat });
      const { status: statusFn, res } = makeRes();

      const out = await chats.createDirect('me', { userId: 'other' }, res);

      expect(chatsService.createDirect).toHaveBeenCalledWith('me', 'other');
      expect(statusFn).toHaveBeenCalledWith(status);
      expect(out).toBe(chat);
    });
  });

  describe('POST /chats/:chatId/messages', () => {
    it.each([
      [true, 201],
      [false, 200],
    ])('created=%s responds %i', async (created, status) => {
      const message = { id: 'm1' };
      messagesService.send.mockResolvedValue({ message, created });
      const { status: statusFn, res } = makeRes();
      const dto = { clientMessageId: 'c1', content: 'hi' };

      const out = await messages.send('me', CHAT_ID, dto, res);

      expect(messagesService.send).toHaveBeenCalledWith('me', CHAT_ID, dto);
      expect(statusFn).toHaveBeenCalledWith(status);
      expect(out).toBe(message);
    });
  });

  it('POST /chats/:chatId/read passes the seq through', async () => {
    chatsService.markRead.mockResolvedValue({ lastReadSeq: 3 });
    await chats.markRead('me', CHAT_ID, { seq: 3 });
    expect(chatsService.markRead).toHaveBeenCalledWith('me', CHAT_ID, 3);
  });

  describe('group routes', () => {
    const OTHER = '22222222-2222-4222-8222-222222222222';
    const detail = { id: CHAT_ID };

    it('POST /chats/groups delegates to the membership service', async () => {
      membership.createGroup.mockResolvedValue(detail);
      const dto = { title: 'Team', memberIds: ['a', 'b'] };
      await expect(chats.createGroup('me', dto)).resolves.toBe(detail);
      expect(membership.createGroup).toHaveBeenCalledWith('me', dto);
    });

    it('PATCH /chats/:chatId renames', async () => {
      membership.rename.mockResolvedValue(detail);
      const dto = { title: 'New' };
      await expect(chats.rename('me', CHAT_ID, dto)).resolves.toBe(detail);
      expect(membership.rename).toHaveBeenCalledWith('me', CHAT_ID, dto);
    });

    it('POST /chats/:chatId/members adds members', async () => {
      membership.addMembers.mockResolvedValue(detail);
      const dto = { userIds: [OTHER] };
      await expect(chats.addMembers('me', CHAT_ID, dto)).resolves.toBe(detail);
      expect(membership.addMembers).toHaveBeenCalledWith('me', CHAT_ID, dto);
    });

    it('POST /chats/:chatId/members/:userId/promote promotes', async () => {
      membership.promote.mockResolvedValue(detail);
      await expect(chats.promote('me', CHAT_ID, OTHER)).resolves.toBe(detail);
      expect(membership.promote).toHaveBeenCalledWith('me', CHAT_ID, OTHER);
    });

    it('DELETE /chats/:chatId/members/:userId removes the member', async () => {
      membership.removeMember.mockResolvedValue(undefined);
      await chats.removeMember('me', CHAT_ID, OTHER);
      expect(membership.removeMember).toHaveBeenCalledWith(
        'me',
        CHAT_ID,
        OTHER,
      );
    });

    it('POST /chats/:chatId/leave leaves', async () => {
      membership.leave.mockResolvedValue(undefined);
      await chats.leave('me', CHAT_ID);
      expect(membership.leave).toHaveBeenCalledWith('me', CHAT_ID);
    });

    it.each([
      ['createGroup', 201],
      ['addMembers', 200],
      ['promote', 200],
      ['removeMember', 204],
      ['leave', 204],
    ])('%s has HTTP status metadata %i', (method, status) => {
      const handler = (
        ChatsController.prototype as unknown as Record<string, object>
      )[method];
      const code = Reflect.getMetadata('__httpCode__', handler) as
        number | undefined;
      // POST defaults to 201 when no @HttpCode is set.
      expect(code ?? 201).toBe(status);
    });
  });
});
