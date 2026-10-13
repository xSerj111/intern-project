import { Test, TestingModule } from '@nestjs/testing';
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';
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

  beforeEach(async () => {
    chatsService = { createDirect: jest.fn(), markRead: jest.fn() };
    messagesService = { send: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatsController, MessagesController],
      providers: [
        { provide: ChatsService, useValue: chatsService },
        { provide: MessagesService, useValue: messagesService },
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
});
