import { Test, type TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UPLOAD_MAX_BYTES } from '@repo/contracts';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { CreateUploadDto } from './dto/create-upload.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

const ME = '11111111-1111-4111-8111-111111111111';
const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';

describe('UploadsController', () => {
  let controller: UploadsController;
  const service = { createUpload: jest.fn(), confirm: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [{ provide: UploadsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(UploadsController);
  });

  it('creates an upload ticket for the caller', async () => {
    const ticket = { uploadId: UPLOAD_ID, url: 'u', fields: {} };
    service.createUpload.mockResolvedValue(ticket);
    const dto = { purpose: 'avatar', contentType: 'image/png', size: 10 };

    await expect(
      controller.createUpload(ME, dto as CreateUploadDto),
    ).resolves.toBe(ticket);
    expect(service.createUpload).toHaveBeenCalledWith(ME, dto);
  });

  it('confirms an upload for the caller', async () => {
    const asset = { id: UPLOAD_ID };
    service.confirm.mockResolvedValue(asset);

    await expect(controller.confirm(ME, UPLOAD_ID)).resolves.toBe(asset);
    expect(service.confirm).toHaveBeenCalledWith(ME, UPLOAD_ID);
  });
});

describe('CreateUploadDto', () => {
  const errorsFor = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(CreateUploadDto, body))).map(
      (e) => e.property,
    );
  const valid = {
    purpose: 'post-image',
    contentType: 'image/png',
    size: 1024,
  };

  it('accepts a valid body, with and without fileName', async () => {
    await expect(errorsFor(valid)).resolves.toEqual([]);
    await expect(errorsFor({ ...valid, fileName: 'a.png' })).resolves.toEqual(
      [],
    );
  });

  it.each([1, UPLOAD_MAX_BYTES])('accepts size %d', async (size) => {
    await expect(errorsFor({ ...valid, size })).resolves.toEqual([]);
  });

  it.each([0, -1, UPLOAD_MAX_BYTES + 1, 1.5, '10', null])(
    'rejects size %p instead of clamping it',
    async (size) => {
      await expect(errorsFor({ ...valid, size })).resolves.toEqual(['size']);
    },
  );

  it('rejects an unknown purpose', async () => {
    await expect(errorsFor({ ...valid, purpose: 'video' })).resolves.toEqual([
      'purpose',
    ]);
  });

  it('rejects a missing or non-string contentType', async () => {
    await expect(errorsFor({ purpose: 'avatar', size: 1 })).resolves.toEqual([
      'contentType',
    ]);
    await expect(errorsFor({ ...valid, contentType: 5 })).resolves.toEqual([
      'contentType',
    ]);
  });

  it('rejects a fileName over 255 characters', async () => {
    await expect(
      errorsFor({ ...valid, fileName: 'a'.repeat(256) }),
    ).resolves.toEqual(['fileName']);
  });
});
