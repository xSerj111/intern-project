import type { EntityManager, Repository } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { TypeOrmOutboxAdapter } from './typeorm-outbox.adapter';

function fakeTx(inTransaction: boolean) {
  const created = { id: 'row-1' } as OutboxEvent;
  const create = jest.fn((_entity: unknown, props: Partial<OutboxEvent>) => ({
    ...props,
  }));
  const save = jest.fn((row: Partial<OutboxEvent>) =>
    Promise.resolve({ ...created, ...row }),
  );
  const tx = {
    queryRunner: { isTransactionActive: inTransaction },
    create,
    save,
  } as unknown as EntityManager;
  return { tx, create, save };
}

describe('TypeOrmOutboxAdapter', () => {
  const defaultRepo = { delete: jest.fn() };
  let adapter: TypeOrmOutboxAdapter;

  beforeEach(() => {
    jest.useFakeTimers();
    defaultRepo.delete.mockReset();
    adapter = new TypeOrmOutboxAdapter(
      defaultRepo as unknown as Repository<OutboxEvent>,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('inserts through the caller transaction manager, not the injected repository', async () => {
    const { tx, create, save } = fakeTx(true);

    const row = await adapter.add('social.post.liked', { postId: 'p1' }, tx);

    expect(create).toHaveBeenCalledWith(
      OutboxEvent,
      expect.objectContaining({
        routingKey: 'social.post.liked',
        payload: { postId: 'p1' },
        occurredAt: expect.any(Date) as Date,
      }),
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(row.id).toBe('row-1');
    expect(defaultRepo.delete).not.toHaveBeenCalled();
  });

  it('wakes listeners only after a short delay when inside a transaction', async () => {
    const listener = jest.fn();
    adapter.onPending(listener);

    await adapter.add('social.post.liked', {}, fakeTx(true).tx);
    expect(listener).not.toHaveBeenCalled();

    jest.runAllTimers();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('wakes listeners immediately outside a transaction', async () => {
    const listener = jest.fn();
    adapter.onPending(listener);

    await adapter.add('social.post.liked', {}, fakeTx(false).tx);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops waking a listener after it unsubscribes', async () => {
    const listener = jest.fn();
    const off = adapter.onPending(listener);
    off();

    await adapter.add('social.post.liked', {}, fakeTx(false).tx);

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not wake listeners when the insert fails', async () => {
    const listener = jest.fn();
    adapter.onPending(listener);
    const { tx, save } = fakeTx(false);
    save.mockRejectedValueOnce(new Error('insert failed'));

    await expect(adapter.add('social.post.liked', {}, tx)).rejects.toThrow(
      'insert failed',
    );
    jest.runAllTimers();

    expect(listener).not.toHaveBeenCalled();
  });

  it('claims pending rows with FOR UPDATE SKIP LOCKED', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'a' }]),
    };
    const tx = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as EntityManager;

    const rows = await adapter.claimPending(10, tx);

    expect(rows).toEqual([{ id: 'a' }]);
    expect(qb.where).toHaveBeenCalledWith('outbox."publishedAt" IS NULL');
    expect(qb.andWhere).toHaveBeenCalledWith('outbox."deadLetteredAt" IS NULL');
    expect(qb.limit).toHaveBeenCalledWith(10);
    expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(qb.setOnLocked).toHaveBeenCalledWith('skip_locked');
  });

  it('records an error without touching attempts', async () => {
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const tx = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as EntityManager;

    await adapter.recordError('a', 'broker down', tx);

    expect(qb.set).toHaveBeenCalledWith({ lastError: 'broker down' });
    expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 'a' });
  });

  it('marks a row dead: bumps attempts, stores the error, sets deadLetteredAt', async () => {
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const tx = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as EntityManager;

    await adapter.markDead('a', 'boom', tx);

    const [set] = qb.set.mock.calls[0] as [Record<string, unknown>];
    expect(set.lastError).toBe('boom');
    expect((set.attempts as () => string)()).toBe('"attempts" + 1');
    expect((set.deadLetteredAt as () => string)()).toBe('now()');
    expect(qb.where).toHaveBeenCalledWith('id = :id', { id: 'a' });
    expect(qb.execute).toHaveBeenCalledTimes(1);
  });

  it('purges published rows older than the cutoff', async () => {
    defaultRepo.delete.mockResolvedValue({ affected: 3 });

    await expect(adapter.purgePublished(new Date())).resolves.toBe(3);
  });
});
