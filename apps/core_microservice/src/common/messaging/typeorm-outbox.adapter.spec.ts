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
    expect(qb.limit).toHaveBeenCalledWith(10);
    expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(qb.setOnLocked).toHaveBeenCalledWith('skip_locked');
  });

  it('purges published rows older than the cutoff', async () => {
    defaultRepo.delete.mockResolvedValue({ affected: 3 });

    await expect(adapter.purgePublished(new Date())).resolves.toBe(3);
  });
});
