import type { EntityManager } from 'typeorm';
import type { OutboxEvent } from './outbox-event.entity';

export interface IOutboxPort {
  /**
   * Inserts a pending event through the CALLER's transaction manager, so the
   * row commits or rolls back together with the business action. After the
   * insert the port signals `onPending` listeners (post-commit when `tx` is a
   * transaction manager).
   */
  add(
    routingKey: string,
    payload: object,
    tx: EntityManager,
  ): Promise<OutboxEvent>;

  /**
   * Subscribes to the "new pending row" wake signal. Returns an unsubscribe
   * function. The relay must still poll: a signal can be lost (e.g. restart).
   */
  onPending(listener: () => void): () => void;

  /**
   * Relay: claims up to `limit` pending rows (oldest first) with
   * `FOR UPDATE SKIP LOCKED`. Locks last until `tx` ends, so call it inside the
   * transaction that also marks the rows.
   */
  claimPending(limit: number, tx: EntityManager): Promise<OutboxEvent[]>;

  /** Relay: sets `publishedAt = now()` and bumps `attempts` for the row. */
  markPublished(id: string, tx: EntityManager): Promise<void>;

  /** Relay: bumps `attempts` and records `lastError` (row stays pending). */
  markFailed(id: string, error: string, tx: EntityManager): Promise<void>;

  /** Relay: deletes published rows older than `olderThan`; returns the count. */
  purgePublished(olderThan: Date): Promise<number>;
}

export const OUTBOX_PORT = Symbol('IOutboxPort');
