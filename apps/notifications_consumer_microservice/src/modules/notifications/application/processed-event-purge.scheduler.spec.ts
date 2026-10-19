import { Logger } from '@nestjs/common';
import { PROCESSED_EVENT_RETENTION_DAYS } from '../domain/entities/processed-event.entity';
import type { IProcessedEventRepository } from '../domain/interfaces/processed-event-repository.port';
import {
  PROCESSED_EVENT_PURGE_INTERVAL_MS,
  ProcessedEventPurgeScheduler,
} from './processed-event-purge.scheduler';

const DAY_MS = 24 * 60 * 60 * 1000;

function setup(deleteProcessedBefore = jest.fn().mockResolvedValue(0)) {
  const repository: IProcessedEventRepository = {
    tryInsert: jest.fn(),
    findById: jest.fn(),
    markFollowUpDone: jest.fn(),
    deleteProcessedBefore,
  };
  return {
    scheduler: new ProcessedEventPurgeScheduler(repository),
    deleteProcessedBefore,
  };
}

describe('ProcessedEventPurgeScheduler', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('deletes markers older than the retention window', async () => {
    const { scheduler, deleteProcessedBefore } = setup();
    const now = new Date('2026-10-14T12:00:00Z');

    await scheduler.purge(now);

    expect(deleteProcessedBefore).toHaveBeenCalledWith(
      new Date(now.getTime() - PROCESSED_EVENT_RETENTION_DAYS * DAY_MS),
    );
  });

  it('purges at startup and on every interval until destroyed', async () => {
    const { scheduler, deleteProcessedBefore } = setup();

    scheduler.onModuleInit();
    expect(deleteProcessedBefore).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(PROCESSED_EVENT_PURGE_INTERVAL_MS * 2);
    expect(deleteProcessedBefore).toHaveBeenCalledTimes(3);

    scheduler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(PROCESSED_EVENT_PURGE_INTERVAL_MS * 2);
    expect(deleteProcessedBefore).toHaveBeenCalledTimes(3);
  });

  it('logs and survives a failing purge', async () => {
    const { scheduler } = setup(jest.fn().mockRejectedValue(new Error('db')));

    await expect(scheduler.purge()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('db'));
  });

  it('skips a tick while the previous purge is still running', async () => {
    let release!: () => void;
    const { scheduler, deleteProcessedBefore } = setup(
      jest.fn(
        () =>
          new Promise<number>((resolve) => {
            release = () => resolve(0);
          }),
      ),
    );

    const first = scheduler.purge();
    await scheduler.purge();
    expect(deleteProcessedBefore).toHaveBeenCalledTimes(1);

    release();
    await first;
    void scheduler.purge();
    expect(deleteProcessedBefore).toHaveBeenCalledTimes(2);
  });
});
