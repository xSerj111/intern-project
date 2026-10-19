import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import 'multer';
import {
  ATTACHMENT_MAX_BYTES,
  AttachmentsController,
  attachmentFilePipe,
} from './attachments.controller';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

const ME = '11111111-1111-4111-8111-111111111111';
const CHAT_ID = '22222222-2222-4222-8222-222222222222';
const MESSAGE_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';

// No buffer: the magic-number check is skipped and the declared type is used.
const fileOf = (mimetype: string, size = 100) =>
  ({ mimetype, size, originalname: 'f' }) as Express.Multer.File;

describe('AttachmentsController', () => {
  let controller: AttachmentsController;
  const service = { uploadAttachment: jest.fn(), attachmentUrl: jest.fn() };

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

  it('uploads through the service', async () => {
    const uploaded = {
      id: ASSET_ID,
      mimeType: 'image/png',
      size: 100,
      originalName: 'f',
    };
    service.uploadAttachment.mockResolvedValue(uploaded);
    const file = fileOf('image/png');

    await expect(controller.upload(ME, file)).resolves.toBe(uploaded);
    expect(service.uploadAttachment).toHaveBeenCalledWith(ME, file);
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

describe('attachmentFilePipe', () => {
  const validate = (file: Express.Multer.File) =>
    attachmentFilePipe().transform(file);

  it.each([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ])('accepts %s', async (mimetype) => {
    const file = fileOf(mimetype);
    await expect(validate(file)).resolves.toBe(file);
  });

  it.each([
    'application/x-msdownload',
    'image/png-evil',
    'text/plain; x',
    'ximage/png',
    'image/svg+xml',
  ])('rejects %s, naming the type', async (mimetype) => {
    const result = validate(fileOf(mimetype));
    await expect(result).rejects.toThrow(BadRequestException);
    await expect(validate(fileOf(mimetype))).rejects.toThrow(
      `type ${mimetype} not allowed`,
    );
  });

  it('rejects a file of 10 MB or more', async () => {
    await expect(
      validate(fileOf('image/png', ATTACHMENT_MAX_BYTES)),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires a file', async () => {
    await expect(
      attachmentFilePipe().transform(undefined as never),
    ).rejects.toThrow(BadRequestException);
  });
});
