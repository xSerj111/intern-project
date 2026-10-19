import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThan, Repository } from 'typeorm';
import { OutboxEvent } from './outbox-event.entity';
import type { IOutboxPort } from './outbox.port';

/**
 * Delay before waking the relay for a row written inside a transaction.
 * TypeORM has no after-commit hook, so the signal is a fixed timer rather than
 * a true post-commit signal. Trade-off: a transaction that outlasts the delay
 * is not visible yet, so the relay finds nothing and the row waits for its
 * 500 ms poll (a latency cost, never a lost event); a rolled-back transaction
 * costs one empty drain.
 */
const POST_COMMIT_WAKE_DELAY_MS = 25;

@Injectable()
export class TypeOrmOutboxAdapter implements IOutboxPort {
  private readonly listeners = new Set<() => void>();

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repository: Repository<OutboxEvent>,
  ) {}

  async add(
    routingKey: string,
    payload: object,
    tx: EntityManager,
  ): Promise<OutboxEvent> {
    const event = await tx.save(
      tx.create(OutboxEvent, { routingKey, payload, occurredAt: new Date() }),
    );
    this.scheduleWake(tx);
    return event;
  }

  onPending(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  claimPending(limit: number, tx: EntityManager): Promise<OutboxEvent[]> {
    return tx
      .createQueryBuilder(OutboxEvent, 'outbox')
      .where('outbox."publishedAt" IS NULL')
      .andWhere('outbox."deadLetteredAt" IS NULL')
      .orderBy('outbox."occurredAt"', 'ASC')
      .limit(limit)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();
  }

  async markPublished(id: string, tx: EntityManager): Promise<void> {
    await tx
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        publishedAt: () => 'now()',
        attempts: () => '"attempts" + 1',
        lastError: null,
      })
      .where('id = :id', { id })
      .execute();
  }

  async markFailed(
    id: string,
    error: string,
    tx: EntityManager,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({ attempts: () => '"attempts" + 1', lastError: error })
      .where('id = :id', { id })
      .execute();
  }

  async recordError(
    id: string,
    error: string,
    tx: EntityManager,
  ): Promise<void> {
    await tx
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({ lastError: error })
      .where('id = :id', { id })
      .execute();
  }

  async markDead(id: string, error: string, tx: EntityManager): Promise<void> {
    await tx
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({
        attempts: () => '"attempts" + 1',
        lastError: error,
        deadLetteredAt: () => 'now()',
      })
      .where('id = :id', { id })
      .execute();
  }

  async purgePublished(olderThan: Date): Promise<number> {
    const result = await this.repository.delete({
      publishedAt: LessThan(olderThan),
    });
    return result.affected ?? 0;
  }

  private scheduleWake(tx: EntityManager): void {
    const inTransaction = tx.queryRunner?.isTransactionActive === true;
    if (!inTransaction) {
      this.wake();
      return;
    }
    const timer = setTimeout(() => this.wake(), POST_COMMIT_WAKE_DELAY_MS);
    timer.unref();
  }

  private wake(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
