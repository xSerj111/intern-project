import { Logger } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { EventEnvelope } from '@repo/shared';
import type { OutboxEvent } from './outbox-event.entity';
import type { IOutboxPort } from './outbox.port';
import {
  OUTBOX_BATCH_SIZE,
  OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_PURGE_INTERVAL_MS,
  OUTBOX_RETENTION_MS,
  OutboxRelay,
} from './outbox-relay';

function row(id: string, occurredAt: string, payload: object = {}) {
  return {
    id,
    routingKey: 'social.post.liked',
    payload,
    occurredAt: new Date(occurredAt),
    publishedAt: null,
    attempts: 0,
    lastError: null,
  } as OutboxEvent;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets pending promise callbacks run (fake timers do not touch microtasks). */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('OutboxRelay', () => {
  const tx = { name: 'tx' } as unknown as EntityManager;
  let pending: OutboxEvent[];
  let listener: (() => void) | undefined;
  let unsubscribe: jest.Mock;
  let outbox: Record<keyof IOutboxPort, jest.Mock>;
  let logSpy: jest.SpyInstance;
  let eventBus: { publish: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let relay: OutboxRelay;
  const calls: string[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    calls.length = 0;
    pending = [];
    listener = undefined;
    unsubscribe = jest.fn();
    outbox = {
      add: jest.fn(),
      onPending: jest.fn((l: () => void) => {
        listener = l;
        return unsubscribe;
      }),
      claimPending: jest.fn(() => {
        // Claimed rows are no longer visible to the next claim in these tests.
        const claimed = pending.splice(0, OUTBOX_BATCH_SIZE);
        return Promise.resolve(claimed);
      }),
      markPublished: jest.fn((id: string) => {
        calls.push(`published:${id}`);
        return Promise.resolve();
      }),
      markFailed: jest.fn((id: string) => {
        calls.push(`failed:${id}`);
        return Promise.resolve();
      }),
      purgePublished: jest.fn(() => Promise.resolve(0)),
    };
    eventBus = {
      publish: jest.fn((envelope: EventEnvelope<unknown>) => {
        calls.push(`publish:${envelope.eventId}`);
        return Promise.resolve();
      }),
    };
    dataSource = {
      transaction: jest.fn((work: (m: EntityManager) => Promise<unknown>) =>
        work(tx),
      ),
    };
    relay = new OutboxRelay(
      dataSource as unknown as DataSource,
      outbox,
      eventBus,
    );
  });

  afterEach(async () => {
    await relay.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('publishes pending rows in occurredAt order with the envelope, inside one transaction', async () => {
    pending = [
      row('a', '2026-01-01T00:00:00.000Z', { postId: 'p1' }),
      row('b', '2026-01-01T00:00:01.000Z', { postId: 'p2' }),
    ];

    await relay.drain();

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(outbox.claimPending).toHaveBeenCalledWith(OUTBOX_BATCH_SIZE, tx);
    expect(eventBus.publish).toHaveBeenNthCalledWith(1, {
      eventId: 'a',
      type: 'social.post.liked',
      version: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { postId: 'p1' },
    });
    expect(eventBus.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ eventId: 'b', payload: { postId: 'p2' } }),
    );
    expect(calls).toEqual([
      'publish:a',
      'published:a',
      'publish:b',
      'published:b',
    ]);
    expect(outbox.markPublished).toHaveBeenCalledWith('a', tx);
  });

  it('sets publishedAt only after the broker confirms', async () => {
    pending = [row('a', '2026-01-01T00:00:00.000Z')];
    const confirm = deferred();
    eventBus.publish.mockReturnValueOnce(confirm.promise);

    const draining = relay.drain();
    await flush();
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(outbox.markPublished).not.toHaveBeenCalled();

    confirm.resolve();
    await draining;
    expect(outbox.markPublished).toHaveBeenCalledWith('a', tx);
  });

  it('on a publish error records attempts/lastError, leaves the row pending and stops the batch', async () => {
    pending = [
      row('a', '2026-01-01T00:00:00.000Z'),
      row('b', '2026-01-01T00:00:01.000Z'),
    ];
    eventBus.publish.mockRejectedValueOnce(new Error('nack'));

    await relay.drain();

    expect(outbox.markFailed).toHaveBeenCalledWith('a', 'nack', tx);
    expect(outbox.markPublished).not.toHaveBeenCalled();
    // Later rows wait so the failed one is retried first next time.
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('backs off after a failure, then retries on the next poll', async () => {
    pending = [row('a', '2026-01-01T00:00:00.000Z')];
    eventBus.publish.mockRejectedValueOnce(new Error('closed'));
    relay.onModuleInit();
    await flush();
    expect(outbox.markFailed).toHaveBeenCalledTimes(1);

    pending = [row('a', '2026-01-01T00:00:00.000Z')];
    await jest.advanceTimersByTimeAsync(OUTBOX_POLL_INTERVAL_MS);
    expect(eventBus.publish).toHaveBeenCalledTimes(1); // still backing off

    await jest.advanceTimersByTimeAsync(5_000);
    expect(eventBus.publish).toHaveBeenCalledTimes(2);
    expect(outbox.markPublished).toHaveBeenCalledWith('a', tx);
  });

  it('keeps draining while full batches come back', async () => {
    pending = Array.from({ length: OUTBOX_BATCH_SIZE + 1 }, (_, i) =>
      row(`r${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()),
    );

    await relay.drain();

    // 100 rows, then 1 row (a short batch ends the loop).
    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(outbox.markPublished).toHaveBeenCalledTimes(OUTBOX_BATCH_SIZE + 1);
  });

  it('on init logs, polls every 500 ms and drains on a wake-up', async () => {
    relay.onModuleInit();
    await flush();
    expect(logSpy).toHaveBeenCalledWith('Outbox relay started');
    expect(outbox.onPending).toHaveBeenCalledTimes(1);
    const claimsAfterStart = outbox.claimPending.mock.calls.length;

    await jest.advanceTimersByTimeAsync(OUTBOX_POLL_INTERVAL_MS);
    expect(outbox.claimPending).toHaveBeenCalledTimes(claimsAfterStart + 1);

    pending = [row('a', '2026-01-01T00:00:00.000Z')];
    listener!();
    await flush();
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('coalesces a wake-up during a drain into one re-drain', async () => {
    pending = [row('a', '2026-01-01T00:00:00.000Z')];
    const confirm = deferred();
    eventBus.publish.mockImplementationOnce((e: EventEnvelope<unknown>) => {
      calls.push(`publish:${e.eventId}`);
      return confirm.promise;
    });
    relay.onModuleInit();
    await flush();

    pending.push(row('b', '2026-01-01T00:00:01.000Z'));
    listener!();
    listener!();
    confirm.resolve();
    await flush();
    await flush();

    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      'publish:a',
      'published:a',
      'publish:b',
      'published:b',
    ]);
  });

  it('purges rows published more than 7 days ago every hour', async () => {
    relay.onModuleInit();
    const now = Date.now();

    await jest.advanceTimersByTimeAsync(OUTBOX_PURGE_INTERVAL_MS);

    expect(outbox.purgePublished).toHaveBeenCalledTimes(1);
    const [[cutoff]] = outbox.purgePublished.mock.calls as [[Date]];
    expect(cutoff.getTime()).toBe(
      now + OUTBOX_PURGE_INTERVAL_MS - OUTBOX_RETENTION_MS,
    );
    expect(OUTBOX_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('on shutdown unsubscribes, stops timers and waits for the in-flight drain', async () => {
    pending = [
      row('a', '2026-01-01T00:00:00.000Z'),
      row('b', '2026-01-01T00:00:01.000Z'),
    ];
    const confirm = deferred();
    eventBus.publish.mockReturnValueOnce(confirm.promise);
    relay.onModuleInit();
    await flush();

    let stopped = false;
    const stopping = relay.onModuleDestroy().then(() => (stopped = true));
    await flush();
    expect(unsubscribe).toHaveBeenCalled();
    expect(stopped).toBe(false);

    confirm.resolve();
    await stopping;
    expect(outbox.markPublished).toHaveBeenCalledWith('a', tx);
    // Stops between rows: `b` stays pending for the next start.
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    listener!();
    await jest.advanceTimersByTimeAsync(OUTBOX_POLL_INTERVAL_MS);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });
});
