import { Test, type TestingModule } from '@nestjs/testing';
import { AttachmentsController } from './attachments.controller';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

const ME = '11111111-1111-4111-8111-111111111111';
const CHAT_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';

describe('AttachmentsController', () => {
  let controller: AttachmentsController;
  const service = { attachmentUrl: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttachmentsController],
      providers: [{ provide: MessagesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AttachmentsController);
  });

  it('returns a fresh attachment URL from the service', async () => {
    const fresh = { url: 'https://signed', expiresAt: '2026-01-01T00:15:00Z' };
    service.attachmentUrl.mockResolvedValue(fresh);

    await expect(
      controller.url(ME, CHAT_ID, MESSAGE_ID, ASSET_ID),
    ).resolves.toBe(fresh);
    expect(service.attachmentUrl).toHaveBeenCalledWith(
      ME,
      CHAT_ID,
      MESSAGE_ID,
      ASSET_ID,
    );
  });
});
