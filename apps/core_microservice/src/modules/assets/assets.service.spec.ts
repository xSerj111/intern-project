import { AssetsService } from './assets.service';
import { Asset } from './domain/entities/asset.entity';

describe('AssetsService', () => {
  const file = {
    buffer: Buffer.from('x'),
    mimetype: 'application/pdf',
    size: 1,
    originalname: 'a.pdf',
  } as Express.Multer.File;

  const build = () => {
    const storage = {
      uploadPrivate: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const repo = {
      save: jest.fn((a: Asset) => Promise.resolve(a)),
      findByIds: jest.fn().mockResolvedValue([]),
      softDeleteMany: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { info: jest.fn(), warn: jest.fn() };
    const config = { s3: { privateBucket: 'innogram-private' } };
    const service = new AssetsService(
      storage as never,
      repo as never,
      config as never,
      logger as never,
    );
    return { service, storage, repo, logger };
  };

  it('uploadPrivate stores the object under chat/{uploaderId}/{uuid}', async () => {
    const { service, storage } = build();

    const asset = await service.uploadPrivate('user-1', file);

    expect(asset.visibility).toBe('PRIVATE');
    expect(asset.storageKey).toMatch(/^chat\/user-1\/[0-9a-f-]{36}$/);
    expect(storage.uploadPrivate).toHaveBeenCalledWith(
      file.buffer,
      asset.storageKey,
      'application/pdf',
    );
  });

  it('uploadPrivate deletes the object and rethrows when saving fails', async () => {
    const { service, storage, repo } = build();
    repo.save.mockRejectedValue(new Error('db down'));

    await expect(service.uploadPrivate('user-1', file)).rejects.toThrow(
      'db down',
    );
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^chat\/user-1\//),
    );
  });

  it('uploadPrivate still rethrows the save error when cleanup fails', async () => {
    const { service, storage, repo, logger } = build();
    repo.save.mockRejectedValue(new Error('db down'));
    storage.delete.mockRejectedValue(new Error('s3 down'));

    await expect(service.uploadPrivate('user-1', file)).rejects.toThrow(
      'db down',
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('passes the transaction manager through softDeleteMany and findByIds', async () => {
    const { service, repo } = build();
    const tx = {} as never;

    await service.softDeleteMany(['a'], tx);
    await service.findByIds(['a'], tx);

    expect(repo.softDeleteMany).toHaveBeenCalledWith(['a'], tx);
    expect(repo.findByIds).toHaveBeenCalledWith(['a'], tx);
  });
});
