import { AssetsService } from './assets.service';

describe('AssetsService', () => {
  const build = () => {
    const storage = {
      presignGet: jest.fn().mockResolvedValue('https://signed'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const repo = {
      findByIds: jest.fn().mockResolvedValue([]),
      softDeleteMany: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AssetsService(storage as never, repo as never);
    return { service, storage, repo };
  };

  it('passes the transaction manager through softDeleteMany and findByIds', async () => {
    const { service, repo } = build();
    const tx = {} as never;

    await service.softDeleteMany(['a'], tx);
    await service.findByIds(['a'], tx);

    expect(repo.softDeleteMany).toHaveBeenCalledWith(['a'], tx);
    expect(repo.findByIds).toHaveBeenCalledWith(['a'], tx);
  });

  it('delegates presignGet and deleteObject to the storage port', async () => {
    const { service, storage } = build();

    await expect(
      service.presignGet('k', { ttlSeconds: 60, downloadName: 'a.pdf' }),
    ).resolves.toBe('https://signed');
    await service.deleteObject('k');

    expect(storage.presignGet).toHaveBeenCalledWith('k', {
      ttlSeconds: 60,
      downloadName: 'a.pdf',
    });
    expect(storage.delete).toHaveBeenCalledWith('k');
  });
});
