import { Logger } from '@nestjs/common';
import type { AppConfigService } from '../../../config/app-config.service';
import type { Asset } from '../domain/entities/asset.entity';
import type { IFileStoragePort } from '../domain/interfaces/file-storage.port';
import type { IUploadRepository } from '../domain/interfaces/upload-repository.port';
import {
  PendingUploadSweeper,
  SWEEP_BATCH_SIZE,
} from './pending-upload.sweeper';

function asset(id: string, key: string | null = `uploads/${id}`): Asset {
  return { id, bucket: 'private', storageKey: key } as Asset;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('PendingUploadSweeper', () => {
  let uploads: { claimSweepable: jest.Mock; hardDelete: jest.Mock };
  let storage: { deleteObject: jest.Mock };
  let sweeper: PendingUploadSweeper;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    uploads = {
      claimSweepable: jest.fn().mockResolvedValue([]),
      hardDelete: jest.fn().mockResolvedValue(undefined),
    };
    storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
    const config = {
      uploads: { sweepIntervalSec: 900, sweepGraceSec: 3600 },
    } as AppConfigService;
    sweeper = new PendingUploadSweeper(
      uploads as unknown as IUploadRepository,
      storage as unknown as IFileStoragePort,
      config,
    );
  });

  afterEach(async () => {
    await sweeper.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('claims at most 500 rows past the grace period', async () => {
    await sweeper.tick();
    expect(uploads.claimSweepable).toHaveBeenCalledWith(SWEEP_BATCH_SIZE, 3600);
    expect(SWEEP_BATCH_SIZE).toBe(500);
    expect(uploads.hardDelete).not.toHaveBeenCalled();
  });

  it('deletes each object, then hard-deletes the rows', async () => {
    uploads.claimSweepable.mockResolvedValue([asset('a'), asset('b')]);
    await sweeper.tick();
    expect(storage.deleteObject).toHaveBeenNthCalledWith(
      1,
      'private',
      'uploads/a',
    );
    expect(storage.deleteObject).toHaveBeenNthCalledWith(
      2,
      'private',
      'uploads/b',
    );
    expect(uploads.hardDelete).toHaveBeenCalledWith(['a', 'b']);
    expect(storage.deleteObject.mock.invocationCallOrder[1]).toBeLessThan(
      uploads.hardDelete.mock.invocationCallOrder[0],
    );
  });

  it('hard-deletes a row without an object key without touching storage', async () => {
    uploads.claimSweepable.mockResolvedValue([asset('a', null)]);
    await sweeper.tick();
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(uploads.hardDelete).toHaveBeenCalledWith(['a']);
  });

  it('keeps a row whose object delete fails and sweeps the others', async () => {
    uploads.claimSweepable.mockResolvedValue([
      asset('a'),
      asset('b'),
      asset('c'),
    ]);
    storage.deleteObject.mockImplementation((_b: string, key: string) =>
      key === 'uploads/b'
        ? Promise.reject(new Error('s3 down'))
        : Promise.resolve(),
    );
    await sweeper.tick();
    expect(storage.deleteObject).toHaveBeenCalledTimes(3);
    expect(uploads.hardDelete).toHaveBeenCalledWith(['a', 'c']);
  });

  it('skips hardDelete when every object delete fails', async () => {
    uploads.claimSweepable.mockResolvedValue([asset('a')]);
    storage.deleteObject.mockRejectedValue(new Error('s3 down'));
    await sweeper.tick();
    expect(uploads.hardDelete).not.toHaveBeenCalled();
  });

  it('never rejects when the repository fails', async () => {
    uploads.claimSweepable.mockRejectedValue(new Error('db down'));
    await expect(sweeper.tick()).resolves.toBeUndefined();
    uploads.claimSweepable.mockResolvedValue([asset('a')]);
    uploads.hardDelete.mockRejectedValueOnce(new Error('db down'));
    await expect(sweeper.tick()).resolves.toBeUndefined();
  });

  it('does not overlap: a tick during a running sweep joins it', async () => {
    const claim = deferred<Asset[]>();
    uploads.claimSweepable.mockReturnValueOnce(claim.promise);
    const first = sweeper.tick();
    const second = sweeper.tick();
    expect(second).toBe(first);
    expect(uploads.claimSweepable).toHaveBeenCalledTimes(1);
    claim.resolve([]);
    await first;
    await sweeper.tick();
    expect(uploads.claimSweepable).toHaveBeenCalledTimes(2);
  });

  it('runs on an unref’d interval from onModuleInit and stops on destroy', async () => {
    jest.useFakeTimers();
    const intervalSpy = jest.spyOn(global, 'setInterval');
    sweeper.onModuleInit();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 900_000);
    const timer = intervalSpy.mock.results[0].value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    expect(uploads.claimSweepable).not.toHaveBeenCalled();

    jest.advanceTimersByTime(900_000);
    await flush();
    expect(uploads.claimSweepable).toHaveBeenCalledTimes(1);

    await sweeper.onModuleDestroy();
    jest.advanceTimersByTime(2 * 900_000);
    await flush();
    expect(uploads.claimSweepable).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy waits for the running sweep', async () => {
    const claim = deferred<Asset[]>();
    uploads.claimSweepable.mockReturnValueOnce(claim.promise);
    void sweeper.tick();
    let done = false;
    const destroyed = sweeper.onModuleDestroy().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    claim.resolve([asset('a')]);
    await destroyed;
    expect(uploads.hardDelete).toHaveBeenCalledWith(['a']);
  });
});
